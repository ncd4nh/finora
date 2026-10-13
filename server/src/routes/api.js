import { Router } from 'express';
import { db, getSettings, setSettings, getSyncState, bumpSync } from '../db.js';
import { today, monthRange, yearRange, addDays, round, pad, fromISO } from '../utils.js';
import {
  HttpError, listWallets, getWallet, netWorth, createTransaction, createTransactions, updateTransaction,
  getTransaction, listTransactions, sumRange, listGoals, goalProgress, contribute,
} from '../services/finance.js';
import {
  listJars, currentPeriodRange, currentStatus, periodStatus, upsertPeriod, updateAllocations,
  transferBetweenJars, incomeInRange,
} from '../services/jars.js';
import { parseMessage, loadCatalog, looksLikeTransactions, looksLikeAdvice } from '../services/parser.js';
import { aiEnabled, interpret, complete, MODEL } from '../services/ai.js';
import { advise, buildContext } from '../services/advisor.js';

const r = Router();
// Các POST chỉ đọc/tính toán, không làm đổi dữ liệu -> không tăng phiên bản đồng bộ
const READ_ONLY_POST = new Set(['/chat', '/savings/preview']);
const h = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res))
    .then((d) => {
      if (req.method !== 'GET' && !READ_ONLY_POST.has(req.route?.path ?? req.path)) {
        const v = bumpSync(req.headers?.['x-client-id']);
        res.set?.('X-Sync-Version', String(v));
      }
      if (d !== undefined) res.json(d);
    })
    .catch(next);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// ---------------- Đồng bộ ----------------
// Thiết bị hỏi định kỳ (rất nhẹ): phiên bản dữ liệu hiện tại + thiết bị nào đổi gần nhất
r.get('/sync', h(() => getSyncState()));

// ---------------- Settings ----------------
r.get('/settings', h(() => ({ ...getSettings(), ai_enabled: aiEnabled(), ai_model: aiEnabled() ? MODEL() : null })));
r.put('/settings', h((req) => setSettings(req.body)));

// ---------------- Ví ----------------
const WALLET_FIELDS = ['name', 'type', 'currency', 'rate_to_base', 'initial_balance', 'aliases', 'color', 'icon', 'include_in_total', 'archived', 'note'];
r.get('/wallets', h((req) => listWallets({ includeArchived: req.query.all === '1' })));
r.post('/wallets', h((req) => {
  const b = pick(req.body, WALLET_FIELDS);
  if (!b.name) throw new HttpError(400, 'Tên ví bắt buộc');
  b.currency = (b.currency || 'VND').toUpperCase();
  if (b.currency === 'VND') b.rate_to_base = 1;
  const cols = Object.keys(b);
  const id = db.prepare(`INSERT INTO wallets(${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(b).lastInsertRowid;
  return getWallet(id);
}));
r.put('/wallets/:id', h((req) => {
  const b = pick(req.body, WALLET_FIELDS);
  if (b.currency) b.currency = b.currency.toUpperCase();
  if (b.currency === 'VND') b.rate_to_base = 1;
  if (Object.keys(b).length)
    db.prepare(`UPDATE wallets SET ${Object.keys(b).map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...b, id: req.params.id });
  return getWallet(req.params.id);
}));
r.delete('/wallets/:id', h((req) => {
  const used = db.prepare('SELECT COUNT(*) c FROM transactions WHERE wallet_id=? OR to_wallet_id=?').get(req.params.id, req.params.id).c;
  if (used && req.query.force !== '1') {
    db.prepare('UPDATE wallets SET archived=1 WHERE id=?').run(req.params.id);
    return { archived: true, message: 'Ví đã có giao dịch nên được lưu trữ thay vì xoá' };
  }
  db.prepare('DELETE FROM wallets WHERE id=?').run(req.params.id);
  return { deleted: true };
}));
// Điều chỉnh số dư thực tế (ghi giao dịch chênh lệch)
r.post('/wallets/:id/adjust', h((req) => {
  const w = getWallet(req.params.id);
  const actual = Number(req.body.actual_balance);
  const diff = round(actual - w.balance, 8);
  if (!diff) return { wallet: w, diff: 0 };
  const type = diff > 0 ? 'income' : 'expense';
  const cat = db.prepare("SELECT id FROM categories WHERE type=? AND name IN ('Thu nhập khác','Chi khác')").get(type);
  createTransaction({ type, amount: Math.abs(diff), wallet_id: w.id, category_id: cat?.id, note: 'Điều chỉnh số dư', source: 'adjust' });
  return { wallet: getWallet(w.id), diff };
}));

// ---------------- Danh mục ----------------
const CAT_FIELDS = ['name', 'type', 'jar_id', 'icon', 'color', 'aliases', 'archived'];
r.get('/categories', h((req) => {
  const where = [];
  if (req.query.type) where.push(`c.type = '${req.query.type === 'income' ? 'income' : 'expense'}'`);
  if (req.query.all !== '1') where.push('c.archived = 0');
  const { start, end } = monthRange(today());
  return db.prepare(
    `SELECT c.*, j.name jar_name, j.color jar_color,
      (SELECT COALESCE(SUM(amount_base),0) FROM transactions t WHERE t.category_id=c.id AND t.date BETWEEN '${start}' AND '${end}') month_total,
      (SELECT COUNT(*) FROM transactions t WHERE t.category_id=c.id) tx_count
     FROM categories c LEFT JOIN jars j ON j.id=c.jar_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.type DESC, c.id`
  ).all();
}));
r.post('/categories', h((req) => {
  const b = pick(req.body, CAT_FIELDS);
  if (!b.name || !b.type) throw new HttpError(400, 'Cần tên và loại (income/expense)');
  const cols = Object.keys(b);
  const id = db.prepare(`INSERT INTO categories(${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(b).lastInsertRowid;
  return db.prepare('SELECT * FROM categories WHERE id=?').get(id);
}));
r.put('/categories/:id', h((req) => {
  const b = pick(req.body, CAT_FIELDS);
  if (Object.keys(b).length)
    db.prepare(`UPDATE categories SET ${Object.keys(b).map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...b, id: req.params.id });
  return db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
}));
r.delete('/categories/:id', h((req) => {
  const used = db.prepare('SELECT COUNT(*) c FROM transactions WHERE category_id=?').get(req.params.id).c;
  if (used) {
    db.prepare('UPDATE categories SET archived=1 WHERE id=?').run(req.params.id);
    return { archived: true };
  }
  db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
  return { deleted: true };
}));

// ---------------- Giao dịch ----------------
r.get('/transactions', h((req) => listTransactions(req.query)));
r.post('/transactions', h((req) => {
  const tx = createTransaction(req.body);
  return { transaction: tx, alerts: alertsFor(tx) };
}));
r.put('/transactions/:id', h((req) => updateTransaction(Number(req.params.id), req.body)));
r.delete('/transactions/:id', h((req) => {
  db.prepare('DELETE FROM savings_contributions WHERE transaction_id=?').run(req.params.id);
  db.prepare('DELETE FROM transactions WHERE id=?').run(req.params.id);
  return { deleted: true };
}));

/** Cảnh báo hũ liên quan tới giao dịch vừa ghi */
function alertsFor(...txs) {
  const st = currentStatus();
  if (!st) return [];
  const jarIds = new Set(txs.filter((t) => t?.type === 'expense').map((t) => t.jar_id));
  return st.alerts.filter((a) => jarIds.has(a.jar_id));
}

// ---------------- Tiết kiệm ----------------
const GOAL_FIELDS = ['name', 'purpose', 'target_amount', 'start_date', 'target_date', 'kind', 'wallet_id', 'jar_id', 'icon', 'color', 'status', 'note'];
r.get('/savings', h((req) => listGoals({ status: req.query.status })));
r.get('/savings/:id', h((req) => {
  const g = db.prepare('SELECT * FROM savings_goals WHERE id=?').get(req.params.id);
  if (!g) throw new HttpError(404, 'Không tìm thấy');
  const contributions = db.prepare(
    'SELECT c.*, w.name wallet_name FROM savings_contributions c LEFT JOIN wallets w ON w.id=c.from_wallet_id WHERE goal_id=? ORDER BY date DESC, id DESC'
  ).all(g.id);
  return { ...goalProgress(g), contributions };
}));
r.post('/savings/preview', h((req) => {
  const b = req.body;
  return goalProgress({ id: -1, ...b, start_date: b.start_date || today(), target_amount: Number(b.target_amount) || 0 });
}));
r.post('/savings', h((req) => {
  const b = pick(req.body, GOAL_FIELDS);
  if (!b.name || !(Number(b.target_amount) > 0) || !b.target_date) throw new HttpError(400, 'Cần tên, số tiền mục tiêu và hạn hoàn thành');
  b.start_date = b.start_date || today();
  if (b.target_date <= b.start_date) throw new HttpError(400, 'Hạn hoàn thành phải sau ngày bắt đầu');
  if (!b.kind) b.kind = goalKind(b.start_date, b.target_date);
  const cols = Object.keys(b);
  const id = db.prepare(`INSERT INTO savings_goals(${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(b).lastInsertRowid;
  if (Number(req.body.initial_saved) > 0) contribute(id, { amount: req.body.initial_saved, note: 'Số dư ban đầu' });
  return goalProgress(db.prepare('SELECT * FROM savings_goals WHERE id=?').get(id));
}));
r.put('/savings/:id', h((req) => {
  const b = pick(req.body, GOAL_FIELDS);
  if (Object.keys(b).length)
    db.prepare(`UPDATE savings_goals SET ${Object.keys(b).map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...b, id: req.params.id });
  return goalProgress(db.prepare('SELECT * FROM savings_goals WHERE id=?').get(req.params.id));
}));
r.delete('/savings/:id', h((req) => {
  db.prepare('DELETE FROM savings_goals WHERE id=?').run(req.params.id);
  return { deleted: true };
}));
r.post('/savings/:id/contribute', h((req) => contribute(Number(req.params.id), req.body)));
r.delete('/savings/contributions/:cid', h((req) => {
  const c = db.prepare('SELECT * FROM savings_contributions WHERE id=?').get(req.params.cid);
  if (c?.transaction_id) db.prepare('DELETE FROM transactions WHERE id=?').run(c.transaction_id);
  db.prepare('DELETE FROM savings_contributions WHERE id=?').run(req.params.cid);
  return { deleted: true };
}));
function goalKind(start, end) {
  return (fromISO(end) - fromISO(start)) / 86400000 > 366 ? 'long' : 'short';
}

// ---------------- Hũ tiền ----------------
const JAR_FIELDS = ['name', 'code', 'percent', 'color', 'icon', 'description', 'is_saving', 'sort_order', 'archived'];
r.get('/jars', h(() => listJars()));
r.put('/jars', h((req) => {
  // Lưu toàn bộ cấu hình hũ: [{id?, name, percent, ...}] ; tổng % phải = 100
  const list = req.body;
  const total = list.filter((j) => !j.archived).reduce((s, j) => s + Number(j.percent || 0), 0);
  if (Math.abs(total - 100) > 0.01) throw new HttpError(400, `Tổng tỷ lệ các hũ phải bằng 100% (hiện ${round(total, 2)}%)`);
  db.transaction(() => {
    list.forEach((j, i) => {
      const b = { ...pick(j, JAR_FIELDS), sort_order: i };
      if (j.id) db.prepare(`UPDATE jars SET ${Object.keys(b).map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...b, id: j.id });
      else {
        const cols = Object.keys(b);
        db.prepare(`INSERT INTO jars(${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(b);
      }
    });
  })();
  return listJars();
}));
r.delete('/jars/:id', h((req) => {
  db.prepare('UPDATE jars SET archived=1, percent=0 WHERE id=?').run(req.params.id);
  return { archived: true };
}));

r.get('/jar-periods', h(() => db.prepare('SELECT * FROM jar_periods ORDER BY start_date DESC').all()));
r.get('/jar-periods/current', h((req) => {
  const d = req.query.date || today();
  const st = currentStatus(d);
  if (st) return st;
  const range = currentPeriodRange(d);
  return { period: null, suggested: { start_date: range.start, end_date: range.end, income_amount: incomeInRange(range.start, range.end) }, jars: listJars() };
}));
r.get('/jar-periods/:id', h((req) => periodStatus(Number(req.params.id), req.query.date || today())));
r.post('/jar-periods', h((req) => upsertPeriod(req.body)));
r.put('/jar-periods/:id', h((req) => updateAllocations(Number(req.params.id), req.body)));
r.delete('/jar-periods/:id', h((req) => {
  db.prepare('DELETE FROM jar_periods WHERE id=?').run(req.params.id);
  return { deleted: true };
}));
r.post('/jar-periods/:id/transfer', h((req) => transferBetweenJars(Number(req.params.id), req.body)));
r.delete('/jar-transfers/:id', h((req) => {
  db.prepare('DELETE FROM jar_transfers WHERE id=?').run(req.params.id);
  return { deleted: true };
}));

// ---------------- Dashboard ----------------
r.get('/dashboard', h((req) => {
  const d = req.query.date || today();
  const m = monthRange(d);
  const y = yearRange(d);
  const year = fromISO(d).getFullYear();

  const monthly = db.prepare(
    `SELECT substr(date,1,7) ym,
      SUM(CASE WHEN type='income' THEN amount_base ELSE 0 END) income,
      SUM(CASE WHEN type='expense' THEN amount_base ELSE 0 END) expense
     FROM transactions WHERE date BETWEEN ? AND ? AND type<>'transfer' GROUP BY ym`
  ).all(y.start, y.end);
  const months = Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${pad(i + 1)}`;
    const row = monthly.find((x) => x.ym === ym) || { income: 0, expense: 0 };
    return { month: i + 1, label: `T${i + 1}`, income: round(row.income), expense: round(row.expense) };
  });

  const from30 = addDays(d, -29);
  const dailyRows = db.prepare(
    `SELECT date, SUM(CASE WHEN type='income' THEN amount_base ELSE 0 END) income,
      SUM(CASE WHEN type='expense' THEN amount_base ELSE 0 END) expense
     FROM transactions WHERE date BETWEEN ? AND ? AND type<>'transfer' GROUP BY date`
  ).all(from30, d);
  const daily = Array.from({ length: 30 }, (_, i) => {
    const dd = addDays(from30, i);
    const row = dailyRows.find((x) => x.date === dd) || { income: 0, expense: 0 };
    return { date: dd, label: dd.slice(8, 10) + '/' + dd.slice(5, 7), income: round(row.income), expense: round(row.expense) };
  });

  const byCategory = db.prepare(
    `SELECT c.id, c.name, c.icon, SUM(t.amount_base) total FROM transactions t JOIN categories c ON c.id=t.category_id
     WHERE t.type='expense' AND t.date BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC`
  ).all(m.start, m.end);

  const goals = listGoals({ status: 'active' });
  return {
    date: d,
    net_worth: round(netWorth()),
    wallets: listWallets(),
    today: sumRange(d, d),
    month: { ...sumRange(m.start, m.end), ...m },
    year: { ...sumRange(y.start, y.end), ...y },
    months,
    daily,
    by_category: byCategory.map((c) => ({ ...c, total: round(c.total) })),
    jar_status: currentStatus(d),
    jar_period_range: currentPeriodRange(d),
    goals_short: goals.filter((g) => g.kind === 'short'),
    goals_long: goals.filter((g) => g.kind === 'long'),
    recent: listTransactions({ limit: 8 }),
  };
}));

// ---------------- Báo cáo "Tổ ong" ----------------
// Ẩn dụ: mỗi mục tiêu tiết kiệm là 1 bông hoa, tiền đã để dành là mật, tổng tiến độ là tổ ong.
r.get('/report/hive', h((req) => {
  const d = req.query.date || today();
  const all = listGoals();
  const active = all.filter((g) => g.status === 'active');
  const done = all.filter((g) => g.status === 'done');
  const flowers = [...active, ...done];
  const saved = flowers.reduce((s, g) => s + g.saved, 0);
  const target = flowers.reduce((s, g) => s + g.target_amount, 0);

  // Chuỗi ngày chăm chỉ: số ngày liên tiếp có ghi chép giao dịch (hôm nay chưa ghi vẫn giữ chuỗi từ hôm qua)
  const days = new Set(
    db.prepare("SELECT DISTINCT date FROM transactions WHERE date <= ? AND date >= date(?, '-400 day') AND source <> 'adjust'")
      .all(d, d).map((x) => x.date)
  );
  let streak = 0;
  let cur = days.has(d) ? d : addDays(d, -1);
  while (days.has(cur)) { streak++; cur = addDays(cur, -1); }
  const m = monthRange(d);
  const activeDays = [...days].filter((x) => x >= m.start && x <= d).length;

  // Mật mỗi tháng = thu - chi của 6 tháng gần nhất
  const months = [];
  const base = fromISO(d);
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const ym = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-01`;
    const rg = monthRange(ym);
    const s = sumRange(rg.start, rg.end > d ? d : rg.end);
    months.push({ label: `T${dt.getMonth() + 1}`, month: ym.slice(0, 7), income: round(s.income), expense: round(s.expense), net: round(s.net) });
  }

  // Kỳ lương hiện tại: mật để dành được trong kỳ
  const st = currentStatus(d);
  const period = st
    ? { start: st.period.start_date, end: st.period.end_date, income: st.income, spent: st.total_spent, kept: round(st.income - st.total_spent), time_percent: st.time_percent, alerts: st.alerts.length }
    : null;

  return {
    date: d,
    saved: round(saved),
    target: round(target),
    percent: target > 0 ? round((saved / target) * 100, 1) : 0,
    need_monthly: round(active.reduce((s, g) => s + g.required_monthly, 0)),
    flowers,
    blooming: done.length,
    behind: active.filter((g) => g.health === 'behind' || g.health === 'overdue').length,
    streak,
    active_days_month: activeDays,
    days_in_month_so_far: Number(d.slice(8, 10)),
    months,
    period,
  };
}));

// ---------------- Chat AI ----------------
const HELP = `Mình có thể:
• Ghi nhanh thu/chi: "Chi 100k Ăn uống Techcombank, Thu 500k Lương BIDV" hoặc nói tự nhiên "hôm qua đổ xăng 50k tiền mặt".
• Chuyển ví: "Chuyển 2tr Techcombank BIDV".
• Thêm ngày/ghi chú: "Chi 45k Đi lại MoMo 08/10 #grab đi làm".
• Tư vấn chia hũ: "Tháng này cần tiết kiệm 5tr mua khoá học, nên chia lương còn lại thế nào?"`;

r.post('/chat', h(async (req) => {
  const message = String(req.body.message || '').trim();
  const history = (req.body.history || []).filter((m) => m && m.role && typeof m.content === 'string');
  if (!message) return { kind: 'text', text: HELP };
  const catalog = loadCatalog();

  const txReply = (items, extra = {}) => ({
    kind: 'transactions',
    text: items.every((i) => !i.error)
      ? `Mình hiểu ${items.length} giao dịch dưới đây. Kiểm tra rồi bấm **Xác nhận** nhé.`
      : 'Có giao dịch chưa rõ, hãy sửa trước khi xác nhận.',
    items,
    ...extra,
  });

  // 1. Hỏi tư vấn
  if (looksLikeAdvice(message) && !/^\s*(chi|thu|chuyển|chuyen)\s+\d/i.test(message)) {
    const a = await advise(message, history);
    return { kind: 'advice', ...a, context: undefined };
  }
  // 2. Ghi giao dịch bằng quy tắc
  if (looksLikeTransactions(message)) {
    const items = parseMessage(message, catalog);
    if (items.every((i) => !i.error) || !aiEnabled()) return txReply(items, { source: 'rules' });
  }
  // 3. Nhờ AI hiểu câu
  if (aiEnabled()) {
    try {
      const ai = await interpret(message, catalog, history);
      if (ai.intent === 'transactions' && ai.formulas.length) {
        const items = ai.formulas.flatMap((f) => parseMessage(f, catalog));
        return txReply(items, { source: 'ai', formulas: ai.formulas });
      }
      if (ai.intent === 'advice') {
        const a = await advise(message, history);
        return { kind: 'advice', ...a, context: undefined };
      }
      return { kind: 'text', text: ai.reply || HELP, source: 'ai' };
    } catch (e) {
      return { kind: 'text', text: `Lỗi gọi AI: ${e.message}\n\n${HELP}` };
    }
  }
  const items = parseMessage(message, catalog);
  if (items.some((i) => !i.error)) return txReply(items, { source: 'rules' });
  return { kind: 'text', text: `Mình chưa hiểu câu này (chưa cấu hình AI nên chỉ hiểu công thức).\n\n${HELP}` };
}));

r.post('/chat/confirm', h((req) => {
  const items = (req.body.items || []).map((i) => ({ ...i, source: 'chat' }));
  if (!items.length) throw new HttpError(400, 'Không có giao dịch');
  const created = createTransactions(items);
  return { created, alerts: alertsFor(...created) };
}));

// Áp dụng gợi ý chia hũ vào kỳ hiện tại
r.post('/chat/apply-allocation', h((req) => {
  const { income, allocations, period } = req.body;
  const range = period?.start ? { start: period.start, end: period.end } : currentPeriodRange();
  const payload = { start_date: range.start, end_date: range.end, income_amount: income, allocations: allocations.map((a) => ({ jar_id: a.jar_id, amount: a.amount })) };
  return upsertPeriod(payload);
}));

r.get('/advice/context', h(() => buildContext()));

export default r;
