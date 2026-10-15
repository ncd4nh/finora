import { Router } from 'express';
import { db, batch, getSettings, setSettings, getSyncState, bumpSync } from '../db.js';
import { today, monthRange, yearRange, addDays, round, pad, fromISO, getPeriod } from '../utils.js';
import {
  HttpError, ownedId, listWallets, getWallet, createTransaction, createTransactions, updateTransaction,
  getTransaction, listTransactions, sumRange, listGoals, goalProgress, contribute,
} from '../services/finance.js';
import {
  listJars, currentPeriodRange, currentStatus, periodStatus, upsertPeriod, updateAllocations,
  transferBetweenJars, incomeInRange, archiveJarStmts,
} from '../services/jars.js';
import { parseMessage, loadCatalog } from '../services/parser.js';
import { classify, answerQuery, smallTalk, notUnderstood } from '../services/assistant.js';
import { aiEnabled, interpret, MODEL } from '../services/ai.js';
import { advise, buildContext } from '../services/advisor.js';
import { clearDemo, demoInfo } from '../demoData.js';

const r = Router();
// Các POST chỉ đọc/tính toán, không làm đổi dữ liệu -> không tăng phiên bản đồng bộ
const READ_ONLY_POST = new Set(['/chat', '/savings/preview']);
const h = (fn) => (req, res, next) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .then(async (d) => {
      if (req.method !== 'GET' && !READ_ONLY_POST.has(req.route?.path ?? req.path)) {
        const v = await bumpSync(req.headers?.['x-client-id']);
        res.set?.('X-Sync-Version', String(v));
      }
      if (d !== undefined) res.json(d);
    })
    .catch(next);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const insertSql = (table, b) => {
  const cols = Object.keys(b);
  return `INSERT INTO ${table}(user_id${cols.map((c) => ',' + c).join('')}) VALUES (@uid${cols.map((c) => ',@' + c).join('')})`;
};
const updateSql = (table, b) => `UPDATE ${table} SET ${Object.keys(b).map((c) => `${c}=@${c}`).join(',')} WHERE user_id=@uid AND id=@id`;
const idOf = (v) => Number(v) || 0;

// ---------------- Đồng bộ ----------------
// Thiết bị hỏi định kỳ (rất nhẹ): phiên bản dữ liệu hiện tại + thiết bị nào đổi gần nhất
r.get('/sync', h(() => getSyncState()));

// ---------------- Settings ----------------
r.get('/settings', h(async () => {
  const { demo_data, ...s } = await getSettings();
  return { ...s, has_demo: !!demo_data || !!(await demoInfo()), ai_enabled: aiEnabled(), ai_model: aiEnabled() ? MODEL() : null };
}));
r.put('/settings', h(async (req) => {
  const b = { ...req.body };
  if (b.default_wallet_id) b.default_wallet_id = await ownedId('wallets', b.default_wallet_id);
  return setSettings(b);
}));
// Xoá dữ liệu mẫu đã tạo lúc đăng ký (giữ nguyên dữ liệu người dùng tự nhập)
r.delete('/demo-data', h(() => clearDemo()));

// ---------------- Ví ----------------
const WALLET_FIELDS = ['name', 'type', 'currency', 'rate_to_base', 'initial_balance', 'aliases', 'color', 'icon', 'include_in_total', 'archived', 'note'];
const uniqueName = (e, what) => {
  if (/UNIQUE/i.test(e.message)) throw new HttpError(409, `${what} này đã có`);
  throw e;
};
r.get('/wallets', h((req) => listWallets({ includeArchived: req.query.all === '1' })));
r.post('/wallets', h(async (req) => {
  const b = pick(req.body, WALLET_FIELDS);
  if (!b.name) throw new HttpError(400, 'Tên ví bắt buộc');
  b.currency = (b.currency || 'VND').toUpperCase();
  if (b.currency === 'VND') b.rate_to_base = 1;
  const { lastInsertRowid: id } = await db.prepare(insertSql('wallets', b)).run(b).catch((e) => uniqueName(e, 'Tên ví'));
  return getWallet(id);
}));
r.put('/wallets/:id', h(async (req) => {
  const b = pick(req.body, WALLET_FIELDS);
  if (b.currency) b.currency = b.currency.toUpperCase();
  if (b.currency === 'VND') b.rate_to_base = 1;
  if (Object.keys(b).length) await db.prepare(updateSql('wallets', b)).run({ ...b, id: idOf(req.params.id) }).catch((e) => uniqueName(e, 'Tên ví'));
  return getWallet(req.params.id);
}));
r.delete('/wallets/:id', h(async (req) => {
  const id = idOf(req.params.id);
  const used = (await db.prepare('SELECT COUNT(*) c FROM transactions WHERE user_id=@uid AND (wallet_id=? OR to_wallet_id=?)').get(id, id)).c;
  if (used && req.query.force !== '1') {
    await db.prepare('UPDATE wallets SET archived=1 WHERE user_id=@uid AND id=?').run(id);
    return { archived: true, message: 'Ví đã có giao dịch nên được lưu trữ thay vì xoá' };
  }
  await batch([
    ['DELETE FROM savings_contributions WHERE user_id=@uid AND transaction_id IN (SELECT id FROM transactions WHERE user_id=@uid AND (wallet_id=? OR to_wallet_id=?))', [id, id]],
    ['DELETE FROM transactions WHERE user_id=@uid AND (wallet_id=? OR to_wallet_id=?)', [id, id]],
    ['UPDATE savings_contributions SET from_wallet_id=NULL WHERE user_id=@uid AND from_wallet_id=?', [id]],
    ['UPDATE savings_goals SET wallet_id=NULL WHERE user_id=@uid AND wallet_id=?', [id]],
    ['DELETE FROM wallets WHERE user_id=@uid AND id=?', [id]],
  ]);
  return { deleted: true };
}));
// Điều chỉnh số dư thực tế (ghi giao dịch chênh lệch)
r.post('/wallets/:id/adjust', h(async (req) => {
  const w = await getWallet(req.params.id);
  const actual = Number(req.body.actual_balance);
  const diff = round(actual - w.balance, 8);
  if (!diff) return { wallet: w, diff: 0 };
  const type = diff > 0 ? 'income' : 'expense';
  const cat = await db.prepare("SELECT id FROM categories WHERE user_id=@uid AND type=? AND name IN ('Thu nhập khác','Chi khác')").get(type);
  await createTransaction({ type, amount: Math.abs(diff), wallet_id: w.id, category_id: cat?.id, note: 'Điều chỉnh số dư', source: 'adjust' });
  return { wallet: await getWallet(w.id), diff };
}));

// ---------------- Danh mục ----------------
const CAT_FIELDS = ['name', 'type', 'jar_id', 'icon', 'color', 'aliases', 'archived'];
const getCategory = async (id) => {
  const c = await db.prepare('SELECT * FROM categories WHERE user_id=@uid AND id=?').get(idOf(id));
  if (!c) throw new HttpError(404, 'Không tìm thấy danh mục');
  return c;
};
r.get('/categories', h((req) => {
  const where = ['c.user_id = @uid'];
  if (req.query.type) where.push(`c.type = '${req.query.type === 'income' ? 'income' : 'expense'}'`);
  if (req.query.all !== '1') where.push('c.archived = 0');
  const { start, end } = monthRange(today());
  return db.prepare(
    `SELECT c.*, j.name jar_name, j.color jar_color,
      (SELECT COALESCE(SUM(amount_base),0) FROM transactions t WHERE t.user_id=@uid AND t.category_id=c.id AND t.date BETWEEN ? AND ?) month_total,
      (SELECT COUNT(*) FROM transactions t WHERE t.user_id=@uid AND t.category_id=c.id) tx_count
     FROM categories c LEFT JOIN jars j ON j.id=c.jar_id AND j.user_id=@uid
     WHERE ${where.join(' AND ')} ORDER BY c.type DESC, c.id`
  ).all(start, end);
}));
r.post('/categories', h(async (req) => {
  const b = pick(req.body, CAT_FIELDS);
  if (!b.name || !['income', 'expense'].includes(b.type)) throw new HttpError(400, 'Cần tên và loại (income/expense)');
  if (b.jar_id !== undefined) b.jar_id = await ownedId('jars', b.jar_id);
  const { lastInsertRowid: id } = await db.prepare(insertSql('categories', b)).run(b).catch((e) => uniqueName(e, 'Danh mục'));
  return getCategory(id);
}));
r.put('/categories/:id', h(async (req) => {
  const b = pick(req.body, CAT_FIELDS);
  if (b.jar_id !== undefined) b.jar_id = await ownedId('jars', b.jar_id);
  if (Object.keys(b).length) await db.prepare(updateSql('categories', b)).run({ ...b, id: idOf(req.params.id) }).catch((e) => uniqueName(e, 'Danh mục'));
  return getCategory(req.params.id);
}));
r.delete('/categories/:id', h(async (req) => {
  const id = idOf(req.params.id);
  const used = (await db.prepare('SELECT COUNT(*) c FROM transactions WHERE user_id=@uid AND category_id=?').get(id)).c;
  if (used) {
    await db.prepare('UPDATE categories SET archived=1 WHERE user_id=@uid AND id=?').run(id);
    return { archived: true };
  }
  await db.prepare('DELETE FROM categories WHERE user_id=@uid AND id=?').run(id);
  return { deleted: true };
}));

// ---------------- Giao dịch ----------------
r.get('/transactions', h((req) => listTransactions(req.query)));
r.post('/transactions', h(async (req) => {
  const tx = await createTransaction(req.body);
  return { transaction: tx, alerts: await alertsFor(tx) };
}));
r.put('/transactions/:id', h((req) => updateTransaction(idOf(req.params.id), req.body)));
r.delete('/transactions/:id', h(async (req) => {
  const id = idOf(req.params.id);
  await batch([
    ['DELETE FROM savings_contributions WHERE user_id=@uid AND transaction_id=?', [id]],
    ['DELETE FROM transactions WHERE user_id=@uid AND id=?', [id]],
  ]);
  return { deleted: true };
}));

/** Cảnh báo hũ liên quan tới giao dịch vừa ghi */
async function alertsFor(...txs) {
  const jarIds = new Set(txs.filter((t) => t?.type === 'expense').map((t) => t.jar_id));
  if (!jarIds.size) return [];
  const st = await currentStatus();
  if (!st) return [];
  return st.alerts.filter((a) => jarIds.has(a.jar_id));
}

// ---------------- Tiết kiệm ----------------
const GOAL_FIELDS = ['name', 'purpose', 'target_amount', 'start_date', 'target_date', 'kind', 'wallet_id', 'jar_id', 'icon', 'color', 'status', 'note'];
const getGoal = (id) => db.prepare('SELECT * FROM savings_goals WHERE user_id=@uid AND id=?').get(idOf(id));
async function goalRefs(b) {
  if (b.wallet_id !== undefined) b.wallet_id = await ownedId('wallets', b.wallet_id);
  if (b.jar_id !== undefined) b.jar_id = await ownedId('jars', b.jar_id);
  return b;
}
r.get('/savings', h((req) => listGoals({ status: req.query.status })));
r.get('/savings/:id', h(async (req) => {
  const g = await getGoal(req.params.id);
  if (!g) throw new HttpError(404, 'Không tìm thấy');
  const contributions = await db.prepare(
    `SELECT c.*, w.name wallet_name FROM savings_contributions c LEFT JOIN wallets w ON w.id=c.from_wallet_id AND w.user_id=@uid
     WHERE c.user_id=@uid AND c.goal_id=? ORDER BY c.date DESC, c.id DESC`
  ).all(g.id);
  return { ...(await goalProgress(g)), contributions };
}));
r.post('/savings/preview', h((req) => {
  const b = req.body;
  return goalProgress({ id: -1, ...b, start_date: b.start_date || today(), target_amount: Number(b.target_amount) || 0 }, today(), 0);
}));
r.post('/savings', h(async (req) => {
  const b = await goalRefs(pick(req.body, GOAL_FIELDS));
  if (!b.name || !(Number(b.target_amount) > 0) || !b.target_date) throw new HttpError(400, 'Cần tên, số tiền mục tiêu và hạn hoàn thành');
  b.start_date = b.start_date || today();
  if (b.target_date <= b.start_date) throw new HttpError(400, 'Hạn hoàn thành phải sau ngày bắt đầu');
  if (!b.kind) b.kind = goalKind(b.start_date, b.target_date);
  const { lastInsertRowid: id } = await db.prepare(insertSql('savings_goals', b)).run(b);
  if (Number(req.body.initial_saved) > 0) await contribute(id, { amount: req.body.initial_saved, note: 'Số dư ban đầu' });
  return goalProgress(await getGoal(id));
}));
r.put('/savings/:id', h(async (req) => {
  const b = await goalRefs(pick(req.body, GOAL_FIELDS));
  if (Object.keys(b).length) await db.prepare(updateSql('savings_goals', b)).run({ ...b, id: idOf(req.params.id) });
  const g = await getGoal(req.params.id);
  if (!g) throw new HttpError(404, 'Không tìm thấy');
  return goalProgress(g);
}));
r.delete('/savings/:id', h(async (req) => {
  const id = idOf(req.params.id);
  await batch([
    ['DELETE FROM savings_contributions WHERE user_id=@uid AND goal_id=?', [id]],
    ['UPDATE transactions SET savings_goal_id=NULL WHERE user_id=@uid AND savings_goal_id=?', [id]],
    ['DELETE FROM savings_goals WHERE user_id=@uid AND id=?', [id]],
  ]);
  return { deleted: true };
}));
r.post('/savings/:id/contribute', h((req) => contribute(idOf(req.params.id), req.body)));
r.delete('/savings/contributions/:cid', h(async (req) => {
  const c = await db.prepare('SELECT * FROM savings_contributions WHERE user_id=@uid AND id=?').get(idOf(req.params.cid));
  if (!c) return { deleted: false };
  await batch([
    c.transaction_id && ['DELETE FROM transactions WHERE user_id=@uid AND id=?', [c.transaction_id]],
    ['DELETE FROM savings_contributions WHERE user_id=@uid AND id=?', [c.id]],
  ]);
  return { deleted: true };
}));
function goalKind(start, end) {
  return (fromISO(end) - fromISO(start)) / 86400000 > 366 ? 'long' : 'short';
}

// ---------------- Hũ tiền ----------------
const JAR_FIELDS = ['name', 'code', 'percent', 'fixed_amount', 'color', 'icon', 'description', 'is_saving', 'sort_order', 'archived'];
r.get('/jars', h(() => listJars()));
r.put('/jars', h(async (req) => {
  // Lưu toàn bộ cấu hình hũ: [{id?, name, percent, ...}] ; tổng % phải = 100
  // Hũ cố định (fixed_amount > 0) nhận đủ số tiền trước; các hũ còn lại chia phần dư theo %, tổng % phải = 100
  const list = (Array.isArray(req.body) ? req.body : []).map((j) => {
    const fixed = Number(j.fixed_amount) > 0 ? Number(j.fixed_amount) : null;
    return { ...j, fixed_amount: fixed, percent: fixed ? 0 : Number(j.percent) || 0 };
  });
  // không bắt buộc đủ 100%: phần chưa chia để ngoài các hũ
  const total = list.filter((j) => !j.archived && !j.fixed_amount).reduce((s, j) => s + j.percent, 0);
  if (total > 100.01) throw new HttpError(400, `Tổng tỷ lệ các hũ chia theo % không được vượt 100% (hiện ${round(total, 2)}%)`);
  // hũ mới trùng tên hũ đã xoá -> dùng lại hũ cũ (tên là duy nhất)
  const archivedByName = new Map((await listJars({ includeArchived: true })).filter((j) => j.archived).map((j) => [j.name.trim().toLowerCase(), j.id]));
  const stmts = [];
  list.forEach((j, i) => {
    if (j.id && j.archived) return stmts.push(...archiveJarStmts(idOf(j.id)));
    const id = j.id ? idOf(j.id) : archivedByName.get(String(j.name || '').trim().toLowerCase());
    const b = { ...pick(j, JAR_FIELDS), archived: 0, sort_order: i };
    stmts.push(id ? [updateSql('jars', b), { ...b, id }] : [insertSql('jars', b), b]);
  });
  await batch(stmts).catch((e) => uniqueName(e, 'Tên hũ'));
  return listJars();
}));
r.delete('/jars/:id', h(async (req) => {
  await batch(archiveJarStmts(idOf(req.params.id)));
  return { archived: true };
}));

r.get('/jar-periods', h(() => db.prepare('SELECT * FROM jar_periods WHERE user_id=@uid ORDER BY start_date DESC').all()));
r.get('/jar-periods/current', h(async (req) => {
  const d = req.query.date || today();
  const st = await currentStatus(d);
  if (st) return st;
  const range = await currentPeriodRange(d);
  const [income, jars, settings] = await Promise.all([incomeInRange(range.start, range.end), listJars(), getSettings()]);
  return { period: null, suggested: { start_date: range.start, end_date: range.end, income_amount: settings.split_amount || income }, jars };
}));
// Xem trước kỳ chia hũ mới. Không truyền start -> kỳ hiện tại nếu chưa chia, ngược lại kỳ ngay sau kỳ đã chia gần nhất
r.get('/jar-periods/preview', h(async (req) => {
  const settings = await getSettings();
  let start = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start || '') ? req.query.start : null;
  if (!start) {
    const cur = await currentPeriodRange(today());
    const last = await db.prepare('SELECT MAX(end_date) e FROM jar_periods WHERE user_id=@uid').get();
    start = !cur.period ? cur.start : addDays(last.e > cur.end ? last.e : cur.end, 1);
  }
  const end = getPeriod(start, settings.salary_day).end;
  const [existing, income] = await Promise.all([
    db.prepare('SELECT id FROM jar_periods WHERE user_id=@uid AND start_date=?').get(start),
    incomeInRange(start, end),
  ]);
  return { start_date: start, end_date: end, income_amount: settings.split_amount || income, existing_id: existing?.id || null };
}));
r.get('/jar-periods/:id', h((req) => periodStatus(idOf(req.params.id), req.query.date || today())));
r.post('/jar-periods', h((req) => upsertPeriod(req.body)));
r.put('/jar-periods/:id', h((req) => updateAllocations(idOf(req.params.id), req.body)));
r.delete('/jar-periods/:id', h(async (req) => {
  const id = idOf(req.params.id);
  await batch([
    ['DELETE FROM jar_allocations WHERE user_id=@uid AND period_id=?', [id]],
    ['DELETE FROM jar_transfers WHERE user_id=@uid AND period_id=?', [id]],
    ['DELETE FROM jar_periods WHERE user_id=@uid AND id=?', [id]],
  ]);
  return { deleted: true };
}));
r.post('/jar-periods/:id/transfer', h((req) => transferBetweenJars(idOf(req.params.id), req.body)));
r.delete('/jar-transfers/:id', h(async (req) => {
  await db.prepare('DELETE FROM jar_transfers WHERE user_id=@uid AND id=?').run(idOf(req.params.id));
  return { deleted: true };
}));

// ---------------- Dashboard ----------------
r.get('/dashboard', h(async (req) => {
  const d = req.query.date || today();
  const m = monthRange(d);
  const y = yearRange(d);
  const year = fromISO(d).getFullYear();
  const from30 = addDays(d, -29);

  // chạy song song để giảm độ trễ khi database ở xa (Turso)
  const [monthly, dailyRows, byCategory, goals, wallets, sToday, sMonth, sYear, jarStatus, jarRange, recent] = await Promise.all([
    db.prepare(
      `SELECT substr(date,1,7) ym,
        SUM(CASE WHEN type='income' THEN amount_base ELSE 0 END) income,
        SUM(CASE WHEN type='expense' THEN amount_base ELSE 0 END) expense
       FROM transactions WHERE user_id=@uid AND date BETWEEN ? AND ? AND type<>'transfer' GROUP BY ym`
    ).all(y.start, y.end),
    db.prepare(
      `SELECT date, SUM(CASE WHEN type='income' THEN amount_base ELSE 0 END) income,
        SUM(CASE WHEN type='expense' THEN amount_base ELSE 0 END) expense
       FROM transactions WHERE user_id=@uid AND date BETWEEN ? AND ? AND type<>'transfer' GROUP BY date`
    ).all(from30, d),
    db.prepare(
      `SELECT c.id, c.name, c.icon, SUM(t.amount_base) total FROM transactions t JOIN categories c ON c.id=t.category_id AND c.user_id=@uid
       WHERE t.user_id=@uid AND t.type='expense' AND t.date BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC`
    ).all(m.start, m.end),
    listGoals({ status: 'active' }),
    listWallets(),
    sumRange(d, d),
    sumRange(m.start, m.end),
    sumRange(y.start, y.end),
    currentStatus(d),
    currentPeriodRange(d),
    listTransactions({ limit: 8 }),
  ]);

  const months = Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${pad(i + 1)}`;
    const row = monthly.find((x) => x.ym === ym) || { income: 0, expense: 0 };
    return { month: i + 1, label: `T${i + 1}`, income: round(row.income), expense: round(row.expense) };
  });
  const daily = Array.from({ length: 30 }, (_, i) => {
    const dd = addDays(from30, i);
    const row = dailyRows.find((x) => x.date === dd) || { income: 0, expense: 0 };
    return { date: dd, label: dd.slice(8, 10) + '/' + dd.slice(5, 7), income: round(row.income), expense: round(row.expense) };
  });

  return {
    date: d,
    net_worth: round(wallets.filter((w) => w.include_in_total).reduce((s, w) => s + w.balance_base, 0)),
    wallets,
    today: sToday,
    month: { ...sMonth, ...m },
    year: { ...sYear, ...y },
    months,
    daily,
    by_category: byCategory.map((c) => ({ ...c, total: round(c.total) })),
    jar_status: jarStatus,
    jar_period_range: jarRange,
    goals_short: goals.filter((g) => g.kind === 'short'),
    goals_long: goals.filter((g) => g.kind === 'long'),
    recent,
  };
}));

// ---------------- Báo cáo "Tổ ong" ----------------
// Ẩn dụ: mỗi mục tiêu tiết kiệm là 1 bông hoa, tiền đã để dành là mật, tổng tiến độ là tổ ong.
r.get('/report/hive', h(async (req) => {
  const d = req.query.date || today();
  const [all, dayRows, st] = await Promise.all([
    listGoals(),
    db.prepare("SELECT DISTINCT date FROM transactions WHERE user_id=@uid AND date <= ? AND date >= date(?, '-400 day') AND source <> 'adjust'").all(d, d),
    currentStatus(d),
  ]);
  const active = all.filter((g) => g.status === 'active');
  const done = all.filter((g) => g.status === 'done');
  const flowers = [...active, ...done];
  const saved = flowers.reduce((s, g) => s + g.saved, 0);
  const target = flowers.reduce((s, g) => s + g.target_amount, 0);

  // Chuỗi ngày chăm chỉ: số ngày liên tiếp có ghi chép giao dịch (hôm nay chưa ghi vẫn giữ chuỗi từ hôm qua)
  const days = new Set(dayRows.map((x) => x.date));
  let streak = 0;
  let cur = days.has(d) ? d : addDays(d, -1);
  while (days.has(cur)) { streak++; cur = addDays(cur, -1); }
  const m = monthRange(d);
  const activeDays = [...days].filter((x) => x >= m.start && x <= d).length;

  // Mật mỗi tháng = thu - chi của 6 tháng gần nhất
  const base = fromISO(d);
  const months = await Promise.all([5, 4, 3, 2, 1, 0].map(async (i) => {
    const dt = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const ym = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-01`;
    const rg = monthRange(ym);
    const s = await sumRange(rg.start, rg.end > d ? d : rg.end);
    return { label: `T${dt.getMonth() + 1}`, month: ym.slice(0, 7), income: round(s.income), expense: round(s.expense), net: round(s.net) };
  }));

  // Kỳ lương hiện tại: mật để dành được trong kỳ
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

// ---------------- Chat ----------------
// Mặc định tự xử lý bằng quy tắc (không cần AI). Có ANTHROPIC_API_KEY thì AI chỉ được gọi khi quy tắc không hiểu.
r.post('/chat', h(async (req) => {
  const message = String(req.body.message || '').trim().slice(0, 1000);
  const history = (req.body.history || []).filter((m) => m && m.role && typeof m.content === 'string');
  const intent = classify(message);
  if (['help', 'greet', 'thanks'].includes(intent)) return smallTalk(intent);
  const catalog = await loadCatalog();

  const txReply = (items, extra = {}) => ({
    kind: 'transactions',
    text: items.every((i) => !i.error)
      ? `Mình hiểu ${items.length} giao dịch dưới đây. Kiểm tra rồi bấm **Xác nhận** nhé.`
      : 'Có giao dịch chưa rõ, hãy sửa trước khi xác nhận.',
    items,
    ...extra,
  });
  const adviceReply = async () => ({ kind: 'advice', ...(await advise(message, history)), context: undefined });

  if (intent === 'advice') return adviceReply();
  if (intent === 'query' || intent === 'unknown') {
    const a = await answerQuery(message, catalog);
    if (a) return a;
  }
  if (intent === 'transactions') {
    const items = parseMessage(message, catalog);
    if (items.every((i) => !i.error) || !aiEnabled()) return txReply(items, { source: 'rules' });
  }
  // Quy tắc không hiểu -> nhờ AI nếu có cấu hình
  if (aiEnabled()) {
    try {
      const ai = await interpret(message, catalog, history);
      if (ai.intent === 'transactions' && ai.formulas.length) {
        const items = ai.formulas.flatMap((f) => parseMessage(f, catalog));
        return txReply(items, { source: 'ai', formulas: ai.formulas });
      }
      if (ai.intent === 'advice') return adviceReply();
      if (ai.reply) return { kind: 'text', text: ai.reply, source: 'ai' };
    } catch { /* AI lỗi -> trả lời bằng quy tắc */ }
  }
  return notUnderstood();
}));

r.post('/chat/confirm', h(async (req) => {
  const items = (req.body.items || []).map((i) => ({ ...i, source: 'chat' }));
  if (!items.length) throw new HttpError(400, 'Không có giao dịch');
  const created = await createTransactions(items);
  return { created, alerts: await alertsFor(...created) };
}));

// Áp dụng gợi ý chia hũ vào kỳ hiện tại
r.post('/chat/apply-allocation', h(async (req) => {
  const { income, allocations, period } = req.body;
  const range = period?.start ? { start: period.start, end: period.end } : await currentPeriodRange();
  const payload = { start_date: range.start, end_date: range.end, income_amount: income, allocations: (allocations || []).map((a) => ({ jar_id: a.jar_id, amount: a.amount })) };
  return upsertPeriod(payload);
}));

r.get('/advice/context', h(() => buildContext()));

export default r;
