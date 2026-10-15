// Nghiệp vụ lõi: số dư ví, tạo giao dịch, tiết kiệm
import { db, tx } from '../db.js';
import { today, daysBetween, monthsBetween, round } from '../utils.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Trả về id nếu bản ghi thuộc người dùng hiện tại, ngược lại báo lỗi 400 */
export async function ownedId(table, id) {
  if (id == null || id === '') return null;
  const row = await db.prepare(`SELECT id FROM ${table} WHERE user_id = @uid AND id = ?`).get(Number(id) || 0);
  if (!row) throw new HttpError(400, 'Dữ liệu tham chiếu không hợp lệ');
  return row.id;
}

// ---------------- Ví ----------------
export async function listWallets({ includeArchived = false } = {}) {
  const rows = await db
    .prepare(
      `SELECT w.*,
        w.initial_balance
        + COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = @uid AND t.wallet_id = w.id AND t.type = 'income' AND t.exclude_balance = 0), 0)
        - COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = @uid AND t.wallet_id = w.id AND t.type IN ('expense','transfer') AND t.exclude_balance = 0), 0)
        + COALESCE((SELECT SUM(to_amount) FROM transactions t WHERE t.user_id = @uid AND t.to_wallet_id = w.id AND t.type = 'transfer' AND t.exclude_balance = 0), 0)
        AS balance
       FROM wallets w
       WHERE w.user_id = @uid ${includeArchived ? '' : 'AND w.archived = 0'}
       ORDER BY w.archived, w.id`
    )
    .all();
  return rows.map((w) => ({ ...w, balance: round(w.balance, 8), balance_base: round(w.balance * w.rate_to_base) }));
}

export async function getWallet(id) {
  const w = (await listWallets({ includeArchived: true })).find((x) => x.id === Number(id));
  if (!w) throw new HttpError(404, 'Không tìm thấy ví');
  return w;
}

export async function netWorth() {
  return (await listWallets())
    .filter((w) => w.include_in_total)
    .reduce((s, w) => s + w.balance_base, 0);
}

// ---------------- Giao dịch ----------------
const insTx = () => db.prepare(`INSERT INTO transactions
  (user_id, type, amount, amount_base, wallet_id, to_wallet_id, to_amount, category_id, jar_id, savings_goal_id, note, date, source, client_ref, exclude_balance)
  VALUES (@uid, @type, @amount, @amount_base, @wallet_id, @to_wallet_id, @to_amount, @category_id, @jar_id, @savings_goal_id, @note, @date, @source, @client_ref, @exclude_balance)`);

/** Chuẩn hoá + kiểm tra 1 giao dịch đầu vào, trả về bản ghi sẵn sàng ghi DB */
export async function buildTransaction(input) {
  const type = input.type;
  if (!['income', 'expense', 'transfer'].includes(type)) throw new HttpError(400, 'Loại giao dịch không hợp lệ');
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new HttpError(400, 'Số tiền phải > 0');
  const wallet = await db.prepare('SELECT * FROM wallets WHERE user_id = @uid AND id = ?').get(Number(input.wallet_id) || 0);
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
    savings_goal_id: input.savings_goal_id ? await ownedId('savings_goals', input.savings_goal_id) : null,
    note: input.note || null,
    date: input.date || today(),
    source: input.source || 'manual',
    client_ref: input.client_ref ? String(input.client_ref).slice(0, 64) : null,
    // giao dịch đã phát sinh trước khi khai báo số dư ví: vẫn hiện + tính báo cáo, nhưng không cộng/trừ vào ví
    exclude_balance: input.exclude_balance === true || input.exclude_balance === 1 || input.exclude_balance === '1' ? 1 : 0,
  };

  if (type === 'transfer') {
    const to = await db.prepare('SELECT * FROM wallets WHERE user_id = @uid AND id = ?').get(Number(input.to_wallet_id) || 0);
    if (!to) throw new HttpError(400, 'Chưa chọn ví nhận');
    if (to.id === wallet.id) throw new HttpError(400, 'Ví nguồn và ví nhận phải khác nhau');
    rec.to_wallet_id = to.id;
    rec.to_amount =
      Number(input.to_amount) > 0 ? Number(input.to_amount) : round((amount * wallet.rate_to_base) / to.rate_to_base, 8);
  } else {
    const cat = input.category_id ? await db.prepare('SELECT * FROM categories WHERE user_id = @uid AND id = ?').get(Number(input.category_id) || 0) : null;
    if (!cat) throw new HttpError(400, 'Chưa chọn khoản thu/chi');
    if (cat.type !== type) throw new HttpError(400, `Danh mục "${cat.name}" không phải khoản ${type === 'income' ? 'thu' : 'chi'}`);
    rec.category_id = cat.id;
    if (type === 'expense') rec.jar_id = input.jar_id ? await ownedId('jars', input.jar_id) : cat.jar_id;
  }
  return rec;
}

export async function createTransaction(input) {
  // Gửi lại cùng client_ref -> trả về giao dịch đã có (idempotent)
  if (input.client_ref) {
    const existed = await db.prepare('SELECT id FROM transactions WHERE user_id = @uid AND client_ref = ?').get(String(input.client_ref));
    if (existed) return getTransaction(existed.id);
  }
  const rec = await buildTransaction(input);
  const id = (await insTx().run(rec)).lastInsertRowid;
  return getTransaction(id);
}

export const createTransactions = tx(async (items) => {
  const out = [];
  for (const i of items) out.push(await createTransaction(i));
  return out;
});

export async function updateTransaction(id, input) {
  const old = await db.prepare('SELECT * FROM transactions WHERE user_id = @uid AND id = ?').get(Number(id) || 0);
  if (!old) throw new HttpError(404, 'Không tìm thấy giao dịch');
  const rec = await buildTransaction({ ...old, ...input });
  await db.prepare(
    `UPDATE transactions SET type=@type, amount=@amount, amount_base=@amount_base, wallet_id=@wallet_id,
     to_wallet_id=@to_wallet_id, to_amount=@to_amount, category_id=@category_id, jar_id=@jar_id,
     savings_goal_id=@savings_goal_id, note=@note, date=@date, exclude_balance=@exclude_balance WHERE user_id=@uid AND id=@id`
  ).run({ ...rec, client_ref: undefined, source: undefined, id: old.id });
  return getTransaction(id);
}

const TX_SELECT = `SELECT t.*, w.name wallet_name, w.currency wallet_currency, tw.name to_wallet_name,
  c.name category_name, c.icon category_icon, j.name jar_name, j.color jar_color, g.name goal_name
  FROM transactions t
  JOIN wallets w ON w.id = t.wallet_id AND w.user_id = t.user_id
  LEFT JOIN wallets tw ON tw.id = t.to_wallet_id AND tw.user_id = t.user_id
  LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
  LEFT JOIN jars j ON j.id = t.jar_id AND j.user_id = t.user_id
  LEFT JOIN savings_goals g ON g.id = t.savings_goal_id AND g.user_id = t.user_id`;

export async function getTransaction(id) {
  return db.prepare(`${TX_SELECT} WHERE t.user_id = @uid AND t.id = ?`).get(Number(id) || 0);
}

export async function listTransactions(q = {}) {
  const where = ['t.user_id = @uid'];
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
  const sql = `${TX_SELECT} WHERE ${where.join(' AND ')}
    ORDER BY t.date DESC, t.id DESC LIMIT ${limit} OFFSET ${offset}`;
  return db.prepare(sql).all(p);
}

/** Tổng thu / chi (VND) trong khoảng ngày */
export async function sumRange(from, to) {
  const r = await db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN type='income' THEN amount_base END),0) income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount_base END),0) expense,
        COUNT(*) count
       FROM transactions WHERE user_id = @uid AND date BETWEEN ? AND ? AND type <> 'transfer'`
    )
    .get(from, to);
  return { income: r.income, expense: r.expense, net: r.income - r.expense, count: r.count };
}

// ---------------- Tiết kiệm ----------------
export async function goalProgress(goal, onDate = today(), savedAmount) {
  const saved = savedAmount ?? (await db.prepare('SELECT COALESCE(SUM(amount),0) s FROM savings_contributions WHERE user_id = @uid AND goal_id = ?').get(goal.id)).s;
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

const GOAL_SELECT = `SELECT g.*, COALESCE((SELECT SUM(amount) FROM savings_contributions sc WHERE sc.user_id = @uid AND sc.goal_id = g.id), 0) saved_sum
  FROM savings_goals g WHERE g.user_id = @uid`;
export async function listGoals({ status } = {}) {
  const rows = status
    ? await db.prepare(`${GOAL_SELECT} AND g.status = ? ORDER BY g.target_date`).all(status)
    : await db.prepare(`${GOAL_SELECT} ORDER BY CASE g.status WHEN 'active' THEN 0 ELSE 1 END, g.target_date`).all();
  return Promise.all(rows.map(({ saved_sum, ...g }) => goalProgress(g, today(), saved_sum)));
}

/**
 * Nạp tiền cho mục tiêu. Nếu mục tiêu có ví giữ tiền riêng và chọn ví nguồn khác -> tạo giao dịch chuyển ví.
 */
export const contribute = tx(async (goalId, { amount, date, from_wallet_id, note }) => {
  const goal = await db.prepare('SELECT * FROM savings_goals WHERE user_id = @uid AND id = ?').get(Number(goalId) || 0);
  if (!goal) throw new HttpError(404, 'Không tìm thấy mục tiêu');
  amount = Number(amount);
  if (!amount) throw new HttpError(400, 'Số tiền không hợp lệ');
  date = date || today();
  let txId = null;
  if (from_wallet_id && goal.wallet_id && Number(from_wallet_id) !== goal.wallet_id) {
    const out = amount > 0;
    const src = out ? Number(from_wallet_id) : goal.wallet_id;
    const dst = out ? goal.wallet_id : Number(from_wallet_id);
    const srcW = await db.prepare('SELECT * FROM wallets WHERE user_id = @uid AND id = ?').get(src);
    if (!srcW) throw new HttpError(400, 'Ví không hợp lệ');
    const tx = await createTransaction({
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
  const fromW = from_wallet_id ? await ownedId('wallets', from_wallet_id) : null;
  const { lastInsertRowid: id } = await db
    .prepare(
      'INSERT INTO savings_contributions(user_id, goal_id, amount, date, from_wallet_id, transaction_id, note) VALUES (@uid,?,?,?,?,?,?)'
    )
    .run(goal.id, amount, date, fromW, txId, note || null);
  const g = await goalProgress(goal);
  if (g.health === 'done' && goal.status === 'active') {
    await db.prepare("UPDATE savings_goals SET status='done' WHERE user_id = @uid AND id = ?").run(goal.id);
    g.status = 'done';
  }
  return { contribution_id: id, goal: g };
});
