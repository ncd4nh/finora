// Dữ liệu mẫu ~100 ngày (dùng cho CLI seed:demo và bản prototype chạy trên trình duyệt)
import { db, getSettings } from './db.js';
import { createTransaction, contribute } from './services/finance.js';
import { upsertPeriod } from './services/jars.js';
import { today, addDays, getPeriod } from './utils.js';

export function hasTransactions() {
  return db.prepare('SELECT COUNT(*) c FROM transactions').get().c > 0;
}

export function seedDemo() {
  const W = Object.fromEntries(db.prepare('SELECT name, id FROM wallets').all().map((r) => [r.name, r.id]));
  const C = Object.fromEntries(db.prepare('SELECT name, id FROM categories').all().map((r) => [r.name, r.id]));
  const upd = db.prepare('UPDATE wallets SET initial_balance=? WHERE id=?');
  upd.run(2_000_000, W['Tiền mặt']);
  upd.run(8_000_000, W['Techcombank']);
  upd.run(5_000_000, W['BIDV']);
  upd.run(500_000, W['MoMo']);
  upd.run(30_000_000, W['Chứng khoán']);
  upd.run(400, W['Crypto (USDT)']);

  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pickN = (a) => a[Math.floor(rnd() * a.length)];
  const salaryDay = getSettings().salary_day;

  const run = db.transaction(() => {
    const end = today();
    let d = addDays(end, -100);
    while (d <= end) {
      const day = Number(d.slice(8, 10));
      if (day === salaryDay) {
        createTransaction({ type: 'income', amount: 25_000_000, wallet_id: W['BIDV'], category_id: C['Lương'], date: d, note: 'Lương tháng' });
        const { start, end: pend } = getPeriod(d, salaryDay);
        upsertPeriod({ start_date: start, end_date: pend, income_amount: 25_000_000 });
      }
      // ăn uống mỗi ngày
      createTransaction({ type: 'expense', amount: pickN([35, 45, 50, 60, 80]) * 1000, wallet_id: pickN([W['Tiền mặt'], W['MoMo'], W['Techcombank']]), category_id: C['Ăn uống'], date: d, note: pickN(['Ăn trưa', 'Bún chả', 'Cơm văn phòng', 'Phở']) });
      if (rnd() < 0.5) createTransaction({ type: 'expense', amount: pickN([25, 30, 45]) * 1000, wallet_id: W['MoMo'], category_id: C['Ăn uống'], date: d, note: 'Cà phê' });
      if (rnd() < 0.3) createTransaction({ type: 'expense', amount: pickN([50, 70, 100]) * 1000, wallet_id: W['Tiền mặt'], category_id: C['Đi lại'], date: d, note: 'Đổ xăng' });
      if (rnd() < 0.15) createTransaction({ type: 'expense', amount: pickN([150, 250, 400]) * 1000, wallet_id: W['Techcombank'], category_id: C['Đi chợ'], date: d });
      if (rnd() < 0.08) createTransaction({ type: 'expense', amount: pickN([200, 350, 600]) * 1000, wallet_id: W['Techcombank'], category_id: C['Mua sắm'], date: d, note: 'Shopee' });
      if (rnd() < 0.06) createTransaction({ type: 'expense', amount: pickN([150, 300]) * 1000, wallet_id: W['Techcombank'], category_id: C['Giải trí'], date: d });
      if (day === 12) {
        createTransaction({ type: 'expense', amount: 4_500_000, wallet_id: W['BIDV'], category_id: C['Nhà ở'], date: d, note: 'Tiền nhà' });
        createTransaction({ type: 'expense', amount: 650_000, wallet_id: W['BIDV'], category_id: C['Hoá đơn'], date: d, note: 'Điện nước internet' });
      }
      if (day === 20 && rnd() < 0.7) createTransaction({ type: 'expense', amount: 500_000, wallet_id: W['Techcombank'], category_id: C['Hiếu hỉ & Biếu tặng'], date: d, note: 'Đám cưới' });
      d = addDays(d, 1);
    }
    // Khoản chi lớn hôm nay -> minh hoạ cảnh báo hũ Hưởng thụ
    createTransaction({ type: 'expense', amount: 1_150_000, wallet_id: W['Techcombank'], category_id: C['Mua sắm'], date: end, note: 'Giày chạy bộ' });
    // Mục tiêu tiết kiệm
    const jar = Object.fromEntries(db.prepare('SELECT code, id FROM jars').all().map((r) => [r.code, r.id]));
    const ins = db.prepare(
      `INSERT INTO savings_goals(name, purpose, target_amount, start_date, target_date, kind, wallet_id, jar_id, icon)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    const g1 = ins.run('Máy ảnh Sony', 'Mua máy ảnh du lịch', 18_000_000, addDays(today(), -60), addDays(today(), 120), 'short', W['Techcombank'], jar.LTSS, '📷').lastInsertRowid;
    const g2 = ins.run('Quỹ khẩn cấp', '6 tháng chi phí sinh hoạt', 60_000_000, addDays(today(), -90), addDays(today(), 640), 'long', W['BIDV'], jar.LTSS, '🛟').lastInsertRowid;
    const g3 = ins.run('Mua ô tô', 'Tích luỹ mua xe gia đình', 300_000_000, addDays(today(), -90), addDays(today(), 2100), 'long', W['Chứng khoán'], jar.FFA, '🚗').lastInsertRowid;
    contribute(g1, { amount: 3_000_000, date: addDays(today(), -55) });
    contribute(g1, { amount: 3_000_000, date: addDays(today(), -25) });
    contribute(g2, { amount: 2_000_000, date: addDays(today(), -80) });
    contribute(g2, { amount: 2_000_000, date: addDays(today(), -50) });
    contribute(g2, { amount: 2_000_000, date: addDays(today(), -20) });
    contribute(g3, { amount: 30_000_000, date: addDays(today(), -90), note: 'Số dư ban đầu' });
  });
  run();
}
