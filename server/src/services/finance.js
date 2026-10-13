// Nghiệp vụ lõi: số dư ví, tạo giao dịch, tiết kiệm
import { db, tx } from '../db.js';
import { today, daysBetween, monthsBetween, round } from '../utils.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------- Ví ----------------
export function listWallets({ includeArchived = false } = {}) {
  const rows = db
    .prepare(
      `SELECT w.*,
        w.initial_balance
        + COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.wallet_id = w.id AND t.type = 'income'), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.wallet_id = w.id AND t.type IN ('expense','transfer')), 0)
        + COALESCE((SELECT SUM(to_amount) FROM transactions t WHERE t.to_wallet_id = w.id AND t.type = 'transfer'), 0)
        AS balance
       FROM wallets w
       ${includeArchived ? '' : 'WHERE w.archived = 0'}
       ORDER BY w.archived, w.id`
    )
    .all();
  return rows.map((w) => ({ ...w, balance: round(w.balance, 8), balance_base: round(w.balance * w.rate_to_base) }));
}

export function getWallet(id) {
  const w = listWallets({ includeArchived: true }).find((x) => x.id === Number(id));
  if (!w) throw new HttpError(404, 'Không tìm thấy ví');
  return w;
}

export function netWorth() {
  return listWallets()
    .filter((w) => w.include_in_total)
    .reduce((s, w) => s + w.balance_base, 0);
}

// ---------------- Giao dịch ----------------
const insTx = () => db.prepare(`INSERT INTO transactions
  (type, amount, amount_base, wallet_id, to_wallet_id, to_amount, category_id, jar_id, savings_goal_id, note, date, source, client_ref)
  VALUES (@type, @amount, @amount_base, @wallet_id, @to_wallet_id, @to_amount, @category_id, @jar_id, @savings_goal_id, @note, @date, @source, @client_ref)`);

/** Chuẩn hoá + kiểm tra 1 giao dịch đầu vào, trả về bản ghi sẵn sàng ghi DB */
export function buildTransaction(input) {
  const type = input.type;
  if (!['income', 'expense', 'transfer'].includes(type)) throw new HttpError(400, 'Loại giao dịch không hợp lệ');
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new HttpError(400, 'Số tiền phải > 0');
  const wallet = db.prepare('SELECT * FROM wallets WHERE id = ?').get(input.wallet_id);
  if (!wallet) throw new HttpError(400, 'Chưa chọn ví hợp lệ');

  const rec = {
    type,
    amount,
    amount_base: round(amount * wallet.rate_to_base),
    wallet_id: wallet.id,
    to_wallet_id: null,
    to_amount: null,
    category_id: null,
    jar_id: null,
    savings_goal_id: input.savings_goal_id || null,
    note: input.note || null,
    date: input.date || today(),
    source: input.source || 'manual',
    client_ref: input.client_ref ? String(input.client_ref).slice(0, 64) : null,
  };

  if (type === 'transfer') {
    const to = db.prepare('SELECT * FROM wallets WHERE id = ?').get(input.to_wallet_id);
    if (!to) throw new HttpError(400, 'Chưa chọn ví nhận');
    if (to.id === wallet.id) throw new HttpError(400, 'Ví nguồn và ví nhận phải khác nhau');
    rec.to_wallet_id = to.id;
    rec.to_amount =
      Number(input.to_amount) > 0 ? Number(input.to_amount) : round((amount * wallet.rate_to_base) / to.rate_to_base, 8);
  } else {
    const cat = input.category_id ? db.prepare('SELECT * FROM categories WHERE id = ?').get(input.category_id) : null;
    if (!cat) throw new HttpError(400, 'Chưa chọn khoản thu/chi');
    if (cat.type !== type) throw new HttpError(400, `Danh mục "${cat.name}" không phải khoản ${type === 'income' ? 'thu' : 'chi'}`);
    rec.category_id = cat.id;
    if (type === 'expense') rec.jar_id = input.jar_id ? Number(input.jar_id) : cat.jar_id;
  }
  return rec;
}

export function createTransaction(input) {
  // Gửi lại cùng client_ref -> trả về giao dịch đã có (idempotent)
  if (input.client_ref) {
    const existed = db.prepare('SELECT id FROM transactions WHERE client_ref = ?').get(String(input.client_ref));
    if (existed) return getTransaction(existed.id);
  }
  const rec = buildTransaction(input);
  const id = insTx().run(rec).lastInsertRowid;
  return getTransaction(id);
}

export const createTransactions = tx((items) => items.map((i) => createTransaction(i)));

export function updateTransaction(id, input) {
  const old = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!old) throw new HttpError(404, 'Không tìm thấy giao dịch');
  const rec = buildTransaction({ ...old, ...input });
  db.prepare(
    `UPDATE transactions SET type=@type, amount=@amount, amount_base=@amount_base, wallet_id=@wallet_id,
     to_wallet_id=@to_wallet_id, to_amount=@to_amount, category_id=@category_id, jar_id=@jar_id,
     savings_goal_id=@savings_goal_id, note=@note, date=@date WHERE id=@id`
  ).run({ ...rec, id });
  return getTransaction(id);
}

const TX_SELECT = `SELECT t.*, w.name wallet_name, w.currency wallet_currency, tw.name to_wallet_name,
  c.name category_name, c.icon category_icon, j.name jar_name, j.color jar_color, g.name goal_name
  FROM transactions t
  JOIN wallets w ON w.id = t.wallet_id
  LEFT JOIN wallets tw ON tw.id = t.to_wallet_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN jars j ON j.id = t.jar_id
  LEFT JOIN savings_goals g ON g.id = t.savings_goal_id`;

export function getTransaction(id) {
  return db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id);
}

export function listTransactions(q = {}) {
  const where = [];
  const p = {};
  if (q.from) (where.push('t.date >= @from'), (p.from = q.from));
  if (q.to) (where.push('t.date <= @to'), (p.to = q.to));
  if (q.type) (where.push('t.type = @type'), (p.type = q.type));
  if (q.wallet_id) (where.push('(t.wallet_id = @wid OR t.to_wallet_id = @wid)'), (p.wid = Number(q.wallet_id)));
  if (q.category_id) (where.push('t.category_id = @cid'), (p.cid = Number(q.category_id)));
  if (q.jar_id) (where.push('t.jar_id = @jid'), (p.jid = Number(q.jar_id)));
  if (q.q) (where.push('(t.note LIKE @kw OR c.name LIKE @kw)'), (p.kw = `%${q.q}%`));
  const limit = Math.min(Number(q.limit) || 200, 2000);
  const offset = Number(q.offset) || 0;
  const sql = `${TX_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.date DESC, t.id DESC LIMIT ${limit} OFFSET ${offset}`;
  return db.prepare(sql).all(p);
}

/** Tổng thu / chi (VND) trong khoảng ngày */
export function sumRange(from, to) {
  const r = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN type='income' THEN amount_base END),0) income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount_base END),0) expense,
        COUNT(*) count
       FROM transactions WHERE date BETWEEN ? AND ? AND type <> 'transfer'`
    )
    .get(from, to);
  return { income: r.income, expense: r.expense, net: r.income - r.expense, count: r.count };
}

// ---------------- Tiết kiệm ----------------
export function goalProgress(goal, onDate = today()) {
  const saved = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM savings_contributions WHERE goal_id = ?').get(goal.id).s;
  const totalMonths = monthsBetween(goal.start_date, goal.target_date);
  const monthsLeft = onDate >= goal.target_date ? 0 : monthsBetween(onDate, goal.target_date);
  const remaining = Math.max(0, goal.target_amount - saved);
  const totalDays = Math.max(1, daysBetween(goal.start_date, goal.target_date));
  const elapsedDays = Math.min(totalDays, Math.max(0, daysBetween(goal.start_date, onDate)));
  const expectedNow = (goal.target_amount * elapsedDays) / totalDays;
  const percent = goal.target_amount > 0 ? Math.min(100, (saved / goal.target_amount) * 100) : 0;
  let health = 'on_track';
  if (saved >= goal.target_amount) health = 'done';
  else if (monthsLeft === 0) health = 'overdue';
  else if (saved < expectedNow * 0.9) health = 'behind';
  else if (saved > expectedNow * 1.1) health = 'ahead';
  return {
    ...goal,
    saved: round(saved),
    remaining: round(remaining),
    percent: round(percent, 1),
    total_months: totalMonths,
    months_left: monthsLeft,
    planned_monthly: round(goal.target_amount / totalMonths),
    required_monthly: round(monthsLeft > 0 ? remaining / monthsLeft : remaining),
    expected_now: round(expectedNow),
    time_percent: round((elapsedDays / totalDays) * 100, 1),
    health,
  };
}

export function listGoals({ status } = {}) {
  const rows = status
    ? db.prepare('SELECT * FROM savings_goals WHERE status = ? ORDER BY target_date').all(status)
    : db.prepare("SELECT * FROM savings_goals ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, target_date").all();
  return rows.map((g) => goalProgress(g));
}

/**
 * Nạp tiền cho mục tiêu. Nếu mục tiêu có ví giữ tiền riêng và chọn ví nguồn khác -> tạo giao dịch chuyển ví.
 */
export const contribute = tx((goalId, { amount, date, from_wallet_id, note }) => {
  const goal = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(goalId);
  if (!goal) throw new HttpError(404, 'Không tìm thấy mục tiêu');
  amount = Number(amount);
  if (!amount) throw new HttpError(400, 'Số tiền không hợp lệ');
  date = date || today();
  let txId = null;
  if (from_wallet_id && goal.wallet_id && Number(from_wallet_id) !== goal.wallet_id) {
    const out = amount > 0;
    const src = out ? Number(from_wallet_id) : goal.wallet_id;
    const dst = out ? goal.wallet_id : Number(from_wallet_id);
    const srcW = db.prepare('SELECT * FROM wallets WHERE id = ?').get(src);
    const tx = createTransaction({
      type: 'transfer',
      amount: Math.abs(amount) / srcW.rate_to_base,
      wallet_id: src,
      to_wallet_id: dst,
      savings_goal_id: goal.id,
      note: note || `${out ? 'Tiết kiệm' : 'Rút tiết kiệm'}: ${goal.name}`,
      date,
      source: 'saving',
    });
    txId = tx.id;
  }
  const id = db
    .prepare(
      'INSERT INTO savings_contributions(goal_id, amount, date, from_wallet_id, transaction_id, note) VALUES (?,?,?,?,?,?)'
    )
    .run(goal.id, amount, date, from_wallet_id || null, txId, note || null).lastInsertRowid;
  const g = goalProgress(goal);
  if (g.health === 'done' && goal.status === 'active') {
    db.prepare("UPDATE savings_goals SET status='done' WHERE id = ?").run(goal.id);
    g.status = 'done';
  }
  return { contribution_id: id, goal: g };
});
