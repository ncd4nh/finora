// Dữ liệu mẫu ~100 ngày (dùng cho CLI seed:demo, nút "dùng dữ liệu mẫu" và bản prototype).
// Có thể xoá lại bằng clearDemo() (nút "Xoá dữ liệu mẫu" trong app).
// Ghi toàn bộ trong vài lệnh gửi 1 lần (batch) để nhanh khi database ở xa (Turso).
import { db, batch, getSettings } from './db.js';
import { today, addDays, getPeriod } from './utils.js';

export async function hasTransactions() {
  return !!(await db.prepare('SELECT 1 FROM transactions WHERE user_id = @uid LIMIT 1').get());
}

export async function seedDemo() {
  const [wallets, cats, settings, before] = await Promise.all([
    db.prepare('SELECT name, id, rate_to_base, initial_balance FROM wallets WHERE user_id = @uid').all(),
    db.prepare('SELECT name, id, jar_id FROM categories WHERE user_id = @uid').all(),
    getSettings(),
    maxIds(),
  ]);
  const W = Object.fromEntries(wallets.map((r) => [r.name, r.id]));
  const rate = Object.fromEntries(wallets.map((r) => [r.id, r.rate_to_base]));
  const C = Object.fromEntries(cats.map((r) => [r.name, r]));
  const salaryDay = settings.salary_day;

  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pickN = (a) => a[Math.floor(rnd() * a.length)];

  const txs = [];
  const add = ({ type, amount, wallet_id, category, date, note = null }) => {
    const c = C[category];
    if (!wallet_id || !c) return;
    txs.push([type, amount, amount * (rate[wallet_id] || 1), wallet_id, c.id, type === 'expense' ? c.jar_id : null, note, date]);
  };
  const periods = [];

  const end = today();
  let d = addDays(end, -100);
  while (d <= end) {
    const day = Number(d.slice(8, 10));
    if (day === salaryDay) {
      add({ type: 'income', amount: 25_000_000, wallet_id: W['BIDV'], category: 'Lương', date: d, note: 'Lương tháng' });
      periods.push(getPeriod(d, salaryDay));
    }
    // ăn uống mỗi ngày
    add({ type: 'expense', amount: pickN([35, 45, 50, 60, 80]) * 1000, wallet_id: pickN([W['Tiền mặt'], W['MoMo'], W['Techcombank']]), category: 'Ăn uống', date: d, note: pickN(['Ăn trưa', 'Bún chả', 'Cơm văn phòng', 'Phở']) });
    if (rnd() < 0.5) add({ type: 'expense', amount: pickN([25, 30, 45]) * 1000, wallet_id: W['MoMo'], category: 'Ăn uống', date: d, note: 'Cà phê' });
    if (rnd() < 0.3) add({ type: 'expense', amount: pickN([50, 70, 100]) * 1000, wallet_id: W['Tiền mặt'], category: 'Đi lại', date: d, note: 'Đổ xăng' });
    if (rnd() < 0.15) add({ type: 'expense', amount: pickN([150, 250, 400]) * 1000, wallet_id: W['Techcombank'], category: 'Đi chợ', date: d });
    if (rnd() < 0.08) add({ type: 'expense', amount: pickN([200, 350, 600]) * 1000, wallet_id: W['Techcombank'], category: 'Mua sắm', date: d, note: 'Shopee' });
    if (rnd() < 0.06) add({ type: 'expense', amount: pickN([150, 300]) * 1000, wallet_id: W['Techcombank'], category: 'Giải trí', date: d });
    if (day === 12) {
      add({ type: 'expense', amount: 4_500_000, wallet_id: W['BIDV'], category: 'Nhà ở', date: d, note: 'Tiền nhà' });
      add({ type: 'expense', amount: 650_000, wallet_id: W['BIDV'], category: 'Hoá đơn', date: d, note: 'Điện nước internet' });
    }
    if (day === 20 && rnd() < 0.7) add({ type: 'expense', amount: 500_000, wallet_id: W['Techcombank'], category: 'Hiếu hỉ & Biếu tặng', date: d, note: 'Đám cưới' });
    d = addDays(d, 1);
  }
  // Khoản chi lớn hôm nay -> minh hoạ cảnh báo hũ Hưởng thụ
  add({ type: 'expense', amount: 1_150_000, wallet_id: W['Techcombank'], category: 'Mua sắm', date: end, note: 'Giày chạy bộ' });

  // Gộp nhiều giao dịch vào 1 câu INSERT (mỗi câu tối đa 100 dòng)
  const txStmts = [];
  for (let i = 0; i < txs.length; i += 100) {
    const chunk = txs.slice(i, i + 100);
    txStmts.push([
      `INSERT INTO transactions(user_id, type, amount, amount_base, wallet_id, category_id, jar_id, note, date, source)
       VALUES ${chunk.map(() => "(@uid,?,?,?,?,?,?,?,?,'demo')").join(',')}`,
      chunk.flat(),
    ]);
  }

  const goals = [
    ['Máy ảnh Sony', 'Mua máy ảnh du lịch', 18_000_000, addDays(end, -60), addDays(end, 120), 'short', W['Techcombank'], 'LTSS', '📷'],
    ['Quỹ khẩn cấp', '6 tháng chi phí sinh hoạt', 60_000_000, addDays(end, -90), addDays(end, 640), 'long', W['BIDV'], 'LTSS', '🛟'],
    ['Mua ô tô', 'Tích luỹ mua xe gia đình', 300_000_000, addDays(end, -90), addDays(end, 2100), 'long', W['Chứng khoán'], 'FFA', '🚗'],
  ];
  const contribs = [
    ['Máy ảnh Sony', 3_000_000, addDays(end, -55), null],
    ['Máy ảnh Sony', 3_000_000, addDays(end, -25), null],
    ['Quỹ khẩn cấp', 2_000_000, addDays(end, -80), null],
    ['Quỹ khẩn cấp', 2_000_000, addDays(end, -50), null],
    ['Quỹ khẩn cấp', 2_000_000, addDays(end, -20), null],
    ['Mua ô tô', 30_000_000, addDays(end, -90), 'Số dư ban đầu'],
  ];
  const balances = [
    ['Tiền mặt', 6_000_000], ['Techcombank', 15_000_000], ['BIDV', 5_000_000],
    ['MoMo', 5_000_000], ['Chứng khoán', 30_000_000], ['Crypto (USDT)', 400],
  ];
  // { id ví: [số dư mẫu, số dư trước đó] } để khi xoá dữ liệu mẫu trả lại số dư cũ
  const oldBalance = Object.fromEntries(wallets.map((r) => [r.id, r.initial_balance]));
  const demoBalances = Object.fromEntries(balances.filter(([name]) => W[name]).map(([name, v]) => [W[name], [v, oldBalance[W[name]] || 0]]));

  await batch([
    ...balances.map(([name, v]) => ['UPDATE wallets SET initial_balance = ? WHERE user_id = @uid AND name = ?', [v, name]]),
    ...txStmts,
    ...periods.map((p) => [
      'INSERT INTO jar_periods(user_id, start_date, end_date, income_amount) VALUES (@uid, ?, ?, 25000000) ON CONFLICT(user_id, start_date) DO NOTHING',
      [p.start, p.end],
    ]),
    // phân bổ theo % mặc định của từng hũ
    [`INSERT INTO jar_allocations(user_id, period_id, jar_id, percent, amount)
      SELECT @uid, p.id, j.id, j.percent, ROUND(p.income_amount * j.percent / 100)
      FROM jar_periods p JOIN jars j ON j.user_id = @uid AND j.archived = 0
      WHERE p.user_id = @uid
      ON CONFLICT(period_id, jar_id) DO NOTHING`],
    ...goals.map(([name, purpose, target, start, until, kind, wallet, jarCode, icon]) => [
      `INSERT INTO savings_goals(user_id, name, purpose, target_amount, start_date, target_date, kind, wallet_id, jar_id, icon)
       VALUES (@uid, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM jars WHERE user_id = @uid AND code = ?), ?)`,
      [name, purpose, target, start, until, kind, wallet, jarCode, icon],
    ]),
    ...contribs.map(([goal, amount, date, note]) => [
      `INSERT INTO savings_contributions(user_id, goal_id, amount, date, note)
       VALUES (@uid, (SELECT MAX(id) FROM savings_goals WHERE user_id = @uid AND name = ?), ?, ?, ?)`,
      [goal, amount, date, note],
    ]),
  ]);

  // Ghi lại những gì vừa tạo để sau này xoá đúng dữ liệu mẫu (giao dịch mẫu có source = 'demo')
  const [goalIds, periodIds] = await Promise.all([
    db.prepare('SELECT id FROM savings_goals WHERE user_id = @uid AND id > ?').all(before.goal),
    db.prepare('SELECT id FROM jar_periods WHERE user_id = @uid AND id > ?').all(before.period),
  ]);
  await db.prepare(`INSERT INTO settings(user_id, key, value) VALUES (@uid, '${DEMO_KEY}', ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`).run(JSON.stringify({
    goals: goalIds.map((r) => r.id),
    periods: periodIds.map((r) => r.id),
    balances: demoBalances,
  }));
}

const DEMO_KEY = 'demo_data';
async function maxIds() {
  const [g, p] = await Promise.all([
    db.prepare('SELECT COALESCE(MAX(id), 0) m FROM savings_goals WHERE user_id = @uid').get(),
    db.prepare('SELECT COALESCE(MAX(id), 0) m FROM jar_periods WHERE user_id = @uid').get(),
  ]);
  return { goal: g.m, period: p.m };
}

/**
 * Xoá dữ liệu mẫu: giao dịch mẫu, mục tiêu tiết kiệm mẫu, kỳ chia hũ mẫu và trả lại số dư ví
 * (nếu người dùng chưa sửa). Dữ liệu người dùng tự nhập được giữ nguyên.
 */
export async function clearDemo() {
  const row = await db.prepare(`SELECT value FROM settings WHERE user_id = @uid AND key = '${DEMO_KEY}'`).get();
  if (!row) return { cleared: false, transactions: 0 };
  let m = {};
  try { m = JSON.parse(row.value || '{}'); } catch { /* hỏng: vẫn xoá giao dịch mẫu */ }
  const ids = (a) => (Array.isArray(a) ? a.map(Number).filter(Boolean) : []);
  const goals = ids(m.goals);
  const periods = ids(m.periods);
  const IN = (a) => `(${a.map(() => '?').join(',')})`;
  const [del] = await batch([
    ["DELETE FROM transactions WHERE user_id = @uid AND source = 'demo'"],
    goals.length && [`DELETE FROM savings_contributions WHERE user_id = @uid AND goal_id IN ${IN(goals)}`, goals],
    goals.length && [`UPDATE transactions SET savings_goal_id = NULL WHERE user_id = @uid AND savings_goal_id IN ${IN(goals)}`, goals],
    goals.length && [`DELETE FROM savings_goals WHERE user_id = @uid AND id IN ${IN(goals)}`, goals],
    periods.length && [`DELETE FROM jar_allocations WHERE user_id = @uid AND period_id IN ${IN(periods)}`, periods],
    periods.length && [`DELETE FROM jar_transfers WHERE user_id = @uid AND period_id IN ${IN(periods)}`, periods],
    periods.length && [`DELETE FROM jar_periods WHERE user_id = @uid AND id IN ${IN(periods)}`, periods],
    ...Object.entries(m.balances || {}).map(([id, [demo, old]]) => [
      'UPDATE wallets SET initial_balance = ? WHERE user_id = @uid AND id = ? AND initial_balance = ?', [old, Number(id), demo],
    ]),
    [`DELETE FROM settings WHERE user_id = @uid AND key = '${DEMO_KEY}'`],
  ]);
  return { cleared: true, transactions: Number(del?.rowsAffected) || 0 };
}
