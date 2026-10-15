// Chạy: npm test  (dùng database file tạm, không đụng dữ liệu thật)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'finora-'));
delete process.env.TURSO_DATABASE_URL;
delete process.env.DATABASE_URL;
const { runWithUser, db, closeDb, getSyncState, bumpSync } = await import('../src/db.js');
const { parseMessage, loadCatalog } = await import('../src/services/parser.js');
const { getPeriod, parseAmount } = await import('../src/utils.js');
const auth = await import('../src/services/auth.js');
const finance = await import('../src/services/finance.js');
const { devOutbox } = await import('../src/services/mailer.js');
const { seedDemo } = await import('../src/demoData.js');
const { default: app } = await import('../src/app.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => { server.close(); closeDb(); });

async function call(token, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const tester = await auth.register({ name: 'Tester', email: 'tester@example.com', password: 'abc12345' });
const inUser = (fn) => runWithUser(tester.user.id, fn);
const parse = (msg) => inUser(async () => parseMessage(msg, await loadCatalog()));

test('đọc số tiền', () => {
  assert.equal(parseAmount('100k'), 100000);
  assert.equal(parseAmount('1tr5'), 1500000);
  assert.equal(parseAmount('1.5tr'), 1500000);
  assert.equal(parseAmount('500.000đ'), 500000);
  assert.equal(parseAmount('2 triệu'), 2000000);
});

test('kỳ lương bắt đầu từ ngày 10', () => {
  assert.deepEqual(getPeriod('2026-10-09', 10), { start: '2026-09-10', end: '2026-10-09' });
  assert.deepEqual(getPeriod('2026-10-10', 10), { start: '2026-10-10', end: '2026-11-09' });
  assert.deepEqual(getPeriod('2026-01-05', 10), { start: '2025-12-10', end: '2026-01-09' });
});

test('công thức chuẩn', async () => {
  const [a, b] = await parse('Chi 100k Đồ ăn Techcombank, Thu 500K BIDV');
  assert.equal(a.type, 'expense'); assert.equal(a.amount, 100000);
  assert.equal(a.category_name, 'Ăn uống'); assert.equal(a.wallet_name, 'Techcombank');
  assert.equal(b.type, 'income'); assert.equal(b.amount, 500000); assert.equal(b.wallet_name, 'BIDV');
});

test('câu tự nhiên', async () => {
  const [a, b] = await parse('Hôm nay dùng ví (Techcombank) mua đồ ăn hết 100k, hôm nay nhận lương ở ví BIDV được 500k');
  assert.equal(a.formula, 'Chi 100k Ăn uống Techcombank');
  assert.equal(b.formula, 'Thu 500k Lương BIDV');
});

test('chuyển ví', async () => {
  const [t] = await parse('Chuyển 2tr Techcombank BIDV');
  assert.equal(t.type, 'transfer'); assert.equal(t.wallet_name, 'Techcombank'); assert.equal(t.to_wallet_name, 'BIDV');
});

test('tài khoản: đăng ký, đăng nhập, đổi & quên mật khẩu', async () => {
  const { token, user } = await auth.register({ name: 'Hải', email: 'Hai@Example.com', password: 'matkhau123' });
  assert.ok(token); assert.equal(user.email, 'hai@example.com');
  await assert.rejects(auth.register({ name: 'X', email: 'hai@example.com', password: 'matkhau123' }), /đã có tài khoản/);
  await assert.rejects(auth.register({ name: 'X', email: 'x@example.com', password: 'ngan' }), /tối thiểu 8/);
  const u = await auth.userFromToken(token);
  assert.equal(u.id, user.id);
  await assert.rejects(auth.login({ email: 'hai@example.com', password: 'sai12345' }), /không đúng/);
  await auth.changePassword(u, { current: 'matkhau123', next: 'matkhaumoi456' });
  await auth.login({ email: 'hai@example.com', password: 'matkhaumoi456' });
  // quên mật khẩu -> email chứa link có token
  await auth.forgotPassword({ email: 'hai@example.com' });
  const mail = devOutbox.at(-1);
  assert.equal(mail.to, 'hai@example.com');
  const tk = decodeURIComponent(mail.text.match(/token=([^\s]+)/)[1]);
  await auth.resetPassword({ token: tk, password: 'datlai789x' });
  await assert.rejects(auth.resetPassword({ token: tk, password: 'datlai789y' }), /hết hạn hoặc đã được dùng/);
  const again = await auth.login({ email: 'hai@example.com', password: 'datlai789x' });
  assert.ok(again.token);
  // email không tồn tại vẫn trả thông báo chung
  const r = await auth.forgotPassword({ email: 'khongco@example.com' });
  assert.equal(r.ok, true);
});

test('câu SQL thiếu lọc người dùng bị chặn', async () => {
  await assert.rejects(inUser(() => db.prepare('SELECT * FROM wallets').all()), /thiếu lọc người dùng/);
  await assert.rejects(db.prepare('SELECT * FROM wallets WHERE user_id = @uid').all(), /Chưa đăng nhập/);
});

test('dữ liệu tách riêng theo người dùng (cả khi đoán id)', async () => {
  const a = await auth.register({ name: 'A', email: 'a@example.com', password: 'abc12345' });
  const b = await auth.register({ name: 'B', email: 'b@example.com', password: 'abc12345' });
  await runWithUser(a.user.id, () => db.prepare("UPDATE wallets SET initial_balance = 777 WHERE user_id = @uid AND name = 'BIDV'").run());
  const va = await runWithUser(a.user.id, () => db.prepare("SELECT initial_balance v FROM wallets WHERE user_id = @uid AND name='BIDV'").get());
  const vb = await runWithUser(b.user.id, () => db.prepare("SELECT initial_balance v FROM wallets WHERE user_id = @uid AND name='BIDV'").get());
  assert.equal(va.v, 777); assert.equal(vb.v, 0);

  // A tạo giao dịch; B thử đọc / sửa / xoá / dùng ví của A qua API
  const wa = (await call(a.token, 'GET', '/api/wallets')).data.find((w) => w.name === 'BIDV');
  const ca = (await call(a.token, 'GET', '/api/categories?type=expense')).data[0];
  const created = await call(a.token, 'POST', '/api/transactions', { type: 'expense', amount: 120000, wallet_id: wa.id, category_id: ca.id });
  assert.equal(created.status, 200);
  const txId = created.data.transaction.id;

  assert.equal((await call(b.token, 'GET', '/api/transactions')).data.length, 0);
  assert.equal((await call(b.token, 'PUT', `/api/transactions/${txId}`, { amount: 1 })).status, 404);
  await call(b.token, 'DELETE', `/api/transactions/${txId}`);
  assert.equal((await call(b.token, 'POST', '/api/transactions', { type: 'expense', amount: 1000, wallet_id: wa.id, category_id: ca.id })).status, 400);
  assert.equal((await call(b.token, 'PUT', `/api/wallets/${wa.id}`, { name: 'hack' })).status, 404);
  assert.equal((await call(b.token, 'PUT', '/api/categories/' + ca.id, { name: 'hack' })).status, 404);
  const jarA = (await call(a.token, 'GET', '/api/jars')).data[0];
  const cb = (await call(b.token, 'GET', '/api/categories?type=expense')).data[0];
  assert.equal((await call(b.token, 'PUT', `/api/categories/${cb.id}`, { jar_id: jarA.id })).status, 400);

  // dữ liệu của A vẫn nguyên vẹn
  const listA = (await call(a.token, 'GET', '/api/transactions')).data;
  assert.equal(listA.length, 1); assert.equal(listA[0].amount, 120000);
  const wA = (await call(a.token, 'GET', '/api/wallets')).data.find((w) => w.id === wa.id);
  assert.equal(wA.name, 'BIDV'); assert.equal(wA.balance, 777 - 120000);
});

test('đồng bộ: phiên bản tăng khi đổi dữ liệu, gửi lại không trùng', async () => {
  const { user } = await auth.register({ name: 'Sync', email: 'sync@example.com', password: 'abc12345' }, null, 'iPhone · Safari');
  await runWithUser(user.id, async () => {
    const v0 = (await getSyncState()).version;
    await bumpSync('tab-A');
    const s = await getSyncState();
    assert.equal(s.version, v0 + 1); assert.equal(s.client, 'tab-A');
    const w = (await db.prepare("SELECT id FROM wallets WHERE user_id = @uid AND name='BIDV'").get()).id;
    const c = (await db.prepare("SELECT id FROM categories WHERE user_id = @uid AND type='expense' LIMIT 1").get()).id;
    const t1 = await finance.createTransaction({ type: 'expense', amount: 50000, wallet_id: w, category_id: c, client_ref: 'ref-123' });
    const t2 = await finance.createTransaction({ type: 'expense', amount: 50000, wallet_id: w, category_id: c, client_ref: 'ref-123' });
    assert.equal(t1.id, t2.id);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM transactions WHERE user_id = @uid AND client_ref='ref-123'").get()).n, 1);
  });
  // cùng client_ref nhưng người dùng khác -> vẫn ghi được (không đụng nhau)
  await runWithUser(tester.user.id, async () => {
    const w = (await db.prepare("SELECT id FROM wallets WHERE user_id = @uid AND name='BIDV'").get()).id;
    const c = (await db.prepare("SELECT id FROM categories WHERE user_id = @uid AND type='expense' LIMIT 1").get()).id;
    const t = await finance.createTransaction({ type: 'expense', amount: 1000, wallet_id: w, category_id: c, client_ref: 'ref-123' });
    assert.ok(t.id);
  });
});

test('giao dịch hàng loạt: lỗi 1 dòng -> huỷ cả lô', async () => {
  const { token } = await auth.register({ name: 'Batch', email: 'batch@example.com', password: 'abc12345' });
  const w = (await call(token, 'GET', '/api/wallets')).data[0];
  const c = (await call(token, 'GET', '/api/categories?type=expense')).data[0];
  const bad = await call(token, 'POST', '/api/chat/confirm', { items: [
    { type: 'expense', amount: 10000, wallet_id: w.id, category_id: c.id },
    { type: 'expense', amount: -5, wallet_id: w.id, category_id: c.id },
  ] });
  assert.equal(bad.status, 400);
  assert.equal((await call(token, 'GET', '/api/transactions')).data.length, 0);
  const ok = await call(token, 'POST', '/api/chat/confirm', { items: [
    { type: 'expense', amount: 10000, wallet_id: w.id, category_id: c.id },
    { type: 'income', amount: 20000, wallet_id: w.id, category_id: (await call(token, 'GET', '/api/categories?type=income')).data[0].id },
  ] });
  assert.equal(ok.status, 200); assert.equal(ok.data.created.length, 2);
});

test('giao dịch "không tính vào số dư ví": vẫn hiện + tính báo cáo, số dư giữ nguyên', async () => {
  const { token } = await auth.register({ name: 'Opening', email: 'opening@example.com', password: 'abc12345' });
  const w = (await call(token, 'GET', '/api/wallets')).data[0];
  const w2 = (await call(token, 'GET', '/api/wallets')).data[1];
  await call(token, 'PUT', `/api/wallets/${w.id}`, { initial_balance: 5_000_000 });
  const c = (await call(token, 'GET', '/api/categories?type=expense')).data[0];
  const before = (await call(token, 'GET', '/api/dashboard')).data.month.expense;

  // khoản chi đã phát sinh trước khi khai báo số dư: chỉ ghi nhận
  const old = await call(token, 'POST', '/api/transactions', { type: 'expense', amount: 200_000, wallet_id: w.id, category_id: c.id, exclude_balance: true });
  assert.equal(old.status, 200); assert.equal(old.data.transaction.exclude_balance, 1);
  await call(token, 'POST', '/api/transactions', { type: 'transfer', amount: 300_000, wallet_id: w.id, to_wallet_id: w2.id, exclude_balance: true });
  const bal = async (id) => (await call(token, 'GET', '/api/wallets')).data.find((x) => x.id === id).balance;
  assert.equal(await bal(w.id), 5_000_000);
  assert.equal(await bal(w2.id), 0);
  assert.equal((await call(token, 'GET', '/api/dashboard')).data.month.expense, before + 200_000);

  // giao dịch bình thường vẫn trừ vào ví; bỏ đánh dấu thì khoản cũ trừ vào ví
  await call(token, 'POST', '/api/transactions', { type: 'expense', amount: 50_000, wallet_id: w.id, category_id: c.id });
  assert.equal(await bal(w.id), 4_950_000);
  await call(token, 'PUT', `/api/transactions/${old.data.transaction.id}`, { exclude_balance: false });
  assert.equal(await bal(w.id), 4_750_000);
});

test('hũ cố định nhận đủ số tiền, phần còn lại chia theo %', async () => {
  const { token } = await auth.register({ name: 'Fixed', email: 'fixed@example.com', password: 'abc12345' });
  const jars = (await call(token, 'GET', '/api/jars')).data;
  const [house, ...others] = jars;
  // % của các hũ còn lại không được vượt 100 (không tính hũ cố định)
  const bad = await call(token, 'PUT', '/api/jars', jars.map((j) => (j.id === house.id ? { ...j, fixed_amount: 4_500_000 } : { ...j, percent: 30 })));
  assert.equal(bad.status, 400);
  const each = Math.floor(100 / others.length);
  const cfg = jars.map((j, i) => (j.id === house.id
    ? { ...j, fixed_amount: 4_500_000, icon: '🏠' }
    : { ...j, fixed_amount: null, percent: i === jars.length - 1 ? 100 - each * (others.length - 1) : each }));
  const saved = await call(token, 'PUT', '/api/jars', cfg);
  assert.equal(saved.status, 200);
  const h0 = saved.data.find((j) => j.id === house.id);
  assert.equal(h0.fixed_amount, 4_500_000); assert.equal(h0.percent, 0); assert.equal(h0.icon, '🏠');

  for (const income of [25_000_000, 30_000_000]) {
    const st = (await call(token, 'POST', '/api/jar-periods', { date: income === 25_000_000 ? '2026-01-15' : '2026-02-15', income_amount: income })).data;
    const h = st.jars.find((j) => j.jar_id === house.id);
    assert.equal(h.allocated, 4_500_000);
    assert.equal(st.jars.reduce((s, j) => s + j.allocated, 0), income);
    const o = st.jars.find((j) => j.jar_id === others[0].id);
    assert.equal(o.allocated, Math.round(((income - 4_500_000) * each) / 100));
  }
  // tổng hũ cố định vượt số tiền chia -> báo lỗi
  assert.equal((await call(token, 'POST', '/api/jar-periods', { date: '2026-03-15', income_amount: 3_000_000 })).status, 400);
  // bỏ cố định -> quay lại chia theo % như cũ
  const back = await call(token, 'PUT', '/api/jars', jars);
  assert.equal(back.status, 200); assert.equal(back.data.find((j) => j.id === house.id).fixed_amount, null);
});

test('chia hũ không đủ 100%, số tiền chia mặc định, xem trước kỳ mới', async () => {
  const { token } = await auth.register({ name: 'Partial', email: 'partial@example.com', password: 'abc12345' });
  const jars = (await call(token, 'GET', '/api/jars')).data;
  // chỉ chia 80%: phần còn lại để ngoài hũ
  const cfg = jars.map((j, i) => ({ ...j, percent: i === 0 ? 80 : 0 }));
  assert.equal((await call(token, 'PUT', '/api/jars', cfg)).status, 200);
  await call(token, 'PUT', '/api/settings', { split_amount: 20_000_000 });
  assert.equal((await call(token, 'GET', '/api/settings')).data.split_amount, 20_000_000);

  // chưa chia kỳ nào -> xem trước = kỳ hiện tại, gợi ý số tiền theo cài đặt
  const p1 = (await call(token, 'GET', '/api/jar-periods/preview')).data;
  assert.equal(p1.income_amount, 20_000_000); assert.equal(p1.existing_id, null);
  const st = (await call(token, 'POST', '/api/jar-periods', { start_date: p1.start_date, income_amount: p1.income_amount })).data;
  assert.equal(st.jars[0].allocated, 16_000_000);
  assert.equal(st.unallocated, 4_000_000);

  // đã chia kỳ hiện tại -> xem trước = kỳ ngay sau đó
  const p2 = (await call(token, 'GET', '/api/jar-periods/preview')).data;
  assert.equal(p2.start_date, (await import('../src/utils.js')).addDays(st.period.end_date, 1));
  const st2 = (await call(token, 'POST', '/api/jar-periods', { start_date: p2.start_date, income_amount: 25_000_000 })).data;
  assert.equal(st2.period.start_date, p2.start_date); assert.equal(st2.jars[0].allocated, 20_000_000);
  // chọn lại ngày của kỳ đã chia -> báo đã tồn tại
  assert.equal((await call(token, 'GET', `/api/jar-periods/preview?start=${p2.start_date}`)).data.existing_id, st2.period.id);
});

test('xoá hũ: giữ kỳ cũ, bỏ phần chia kỳ hiện tại, gỡ khoản chi, tạo lại trùng tên', async () => {
  const { token } = await auth.register({ name: 'DelJar', email: 'deljar@example.com', password: 'abc12345' });
  const { addDays } = await import('../src/utils.js');
  const jars = (await call(token, 'GET', '/api/jars')).data;
  const gone = jars.find((j) => j.percent === 10);
  const cat = (await call(token, 'GET', '/api/categories?type=expense')).data[0];
  await call(token, 'PUT', `/api/categories/${cat.id}`, { jar_id: gone.id });
  // 1 kỳ đã qua + kỳ hiện tại, đều có chia cho hũ sắp xoá
  const cur = (await call(token, 'POST', '/api/jar-periods', { income_amount: 10_000_000 })).data;
  const old = (await call(token, 'POST', '/api/jar-periods', { start_date: addDays(cur.period.start_date, -40), income_amount: 10_000_000 })).data;
  await call(token, 'POST', '/api/transactions', { type: 'expense', amount: 300_000, wallet_id: (await call(token, 'GET', '/api/wallets')).data[0].id, category_id: cat.id });

  const res = await call(token, 'PUT', '/api/jars', jars.map((j) => (j.id === gone.id ? { ...j, archived: 1 } : j)));
  assert.equal(res.status, 200);
  assert.ok(!res.data.some((j) => j.id === gone.id));
  assert.equal((await call(token, 'GET', `/api/categories?type=expense`)).data.find((c) => c.id === cat.id).jar_id, null);
  const curAfter = (await call(token, 'GET', `/api/jar-periods/${cur.period.id}`)).data;
  assert.ok(!curAfter.jars.some((j) => j.jar_id === gone.id));
  assert.equal(curAfter.unallocated, 1_000_000);
  assert.equal(curAfter.unassigned_spent, 300_000); // khoản chi đã gắn hũ bị xoá -> tính là chưa gắn hũ
  const oldAfter = (await call(token, 'GET', `/api/jar-periods/${old.period.id}`)).data;
  assert.equal(oldAfter.jars.find((j) => j.jar_id === gone.id).allocated, 1_000_000);

  // tạo lại hũ cùng tên -> dùng lại hũ cũ, không lỗi trùng tên
  const again = await call(token, 'PUT', '/api/jars', [...res.data, { name: gone.name, percent: 0, icon: '🆕' }]);
  assert.equal(again.status, 200);
  assert.equal(again.data.find((j) => j.name === gone.name).id, gone.id);
  // DELETE cũng xoá theo cùng quy tắc
  assert.equal((await call(token, 'DELETE', `/api/jars/${gone.id}`)).status, 200);
  assert.ok(!(await call(token, 'GET', '/api/jars')).data.some((j) => j.id === gone.id));
});

test('dữ liệu mẫu + toàn bộ màn hình API chạy được', async () => {
  const { token } = await auth.register({ name: 'Demo', email: 'demo2@example.com', password: 'abc12345', demo: true }, seedDemo);
  const dash = await call(token, 'GET', '/api/dashboard');
  assert.equal(dash.status, 200);
  assert.ok(dash.data.recent.length > 0);
  assert.ok(dash.data.net_worth > 0);
  assert.ok(dash.data.jar_status?.jars?.length === 6);
  assert.equal(dash.data.goals_short.length + dash.data.goals_long.length, 3);
  for (const url of ['/api/wallets', '/api/categories', '/api/jars', '/api/jar-periods', '/api/jar-periods/current', '/api/savings',
    '/api/report/hive', '/api/settings', '/api/sync', '/api/advice/context', '/api/transactions?limit=5']) {
    const r = await call(token, 'GET', url);
    assert.equal(r.status, 200, `${url}: ${JSON.stringify(r.data)}`);
  }
  const hive = (await call(token, 'GET', '/api/report/hive')).data;
  assert.equal(hive.flowers.length, 3); assert.equal(hive.months.length, 6);

  const chat = await call(token, 'POST', '/api/chat', { message: 'Chi 100k Đồ ăn Techcombank, Thu 500K BIDV' });
  assert.equal(chat.data.kind, 'transactions'); assert.equal(chat.data.items.length, 2);
  const advice = await call(token, 'POST', '/api/chat', { message: 'Tháng này tôi cần tiết kiệm 5tr để mua khoá học, nên chia thế nào?' });
  assert.equal(advice.data.kind, 'advice'); assert.ok(advice.data.allocations.length);
  const applied = await call(token, 'POST', '/api/chat/apply-allocation', advice.data);
  assert.equal(applied.status, 200);

  // tiết kiệm: tạo, nạp, xem, xoá
  const wallets = (await call(token, 'GET', '/api/wallets')).data;
  const g = await call(token, 'POST', '/api/savings', { name: 'Khoá học', target_amount: 5_000_000, target_date: '2099-01-01', wallet_id: wallets[1].id, initial_saved: 1_000_000 });
  assert.equal(g.status, 200); assert.equal(g.data.saved, 1_000_000);
  const ct = await call(token, 'POST', `/api/savings/${g.data.id}/contribute`, { amount: 500_000, from_wallet_id: wallets[0].id });
  assert.equal(ct.data.goal.saved, 1_500_000);
  const detail = (await call(token, 'GET', `/api/savings/${g.data.id}`)).data;
  assert.equal(detail.contributions.length, 2);
  assert.equal((await call(token, 'DELETE', `/api/savings/contributions/${detail.contributions[0].id}`)).status, 200);
  assert.equal((await call(token, 'DELETE', `/api/savings/${g.data.id}`)).status, 200);

  // hũ: chuyển giữa hũ, sửa phân bổ
  const cur = (await call(token, 'GET', '/api/jar-periods/current')).data;
  const [j1, j2] = cur.jars;
  const tr = await call(token, 'POST', `/api/jar-periods/${cur.period.id}/transfer`, { from_jar_id: j1.jar_id, to_jar_id: j2.jar_id, amount: 100000 });
  assert.equal(tr.status, 200); assert.equal(tr.data.transfers.length, 1);
  const upd = await call(token, 'PUT', `/api/jar-periods/${cur.period.id}`, { income_amount: 30_000_000 });
  assert.equal(upd.data.income, 30_000_000);

  // ví: thêm, điều chỉnh số dư, xoá
  const nw = await call(token, 'POST', '/api/wallets', { name: 'Ví mới', type: 'cash', initial_balance: 100000 });
  assert.equal(nw.data.balance, 100000);
  assert.equal((await call(token, 'POST', '/api/wallets', { name: 'Ví mới' })).status, 409);
  const adj = await call(token, 'POST', `/api/wallets/${nw.data.id}/adjust`, { actual_balance: 150000 });
  assert.equal(adj.data.wallet.balance, 150000);
  assert.equal((await call(token, 'DELETE', `/api/wallets/${nw.data.id}?force=1`)).data.deleted, true);

  // hũ: lưu cấu hình
  const jars = (await call(token, 'GET', '/api/jars')).data;
  const saved = await call(token, 'PUT', '/api/jars', jars.map((j) => ({ ...j, percent: j.code === 'NEC' ? 50 : j.code === 'PLAY' ? 15 : j.percent })));
  assert.equal(saved.status, 200); assert.equal(saved.data.find((j) => j.code === 'PLAY').percent, 15);

  // xoá tài khoản xoá sạch dữ liệu
  const me = await auth.userFromToken(token);
  await call(token, 'DELETE', '/api/auth/me');
  await runWithUser(me.id, async () => {
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM transactions WHERE user_id = @uid').get()).n, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM wallets WHERE user_id = @uid').get()).n, 0);
  });
});

test('thiết bị: liệt kê và đăng xuất thiết bị khác', async () => {
  await auth.register({ name: 'D', email: 'dev@example.com', password: 'abc12345' }, null, 'Windows · Chrome');
  const phone = await auth.login({ email: 'dev@example.com', password: 'abc12345' }, 'iPhone · Safari');
  const me = await auth.userFromToken(phone.token);
  const list = await auth.listSessions(me);
  assert.equal(list.length, 2);
  assert.equal(list.find((s) => s.current).device, 'iPhone · Safari');
  const other = list.find((s) => !s.current);
  await auth.revokeSession(me, other.id);
  assert.equal((await auth.listSessions(me)).length, 1);
});

test('trợ lý: phân loại câu ngắn không cần AI', async () => {
  const { classify } = await import('../src/services/assistant.js');
  const cases = {
    'ăn trưa 45k momo': 'transactions', 'cafe 25k': 'transactions', 'Chi 100k Ăn uống TCB': 'transactions',
    'hôm nay chi bao nhiêu': 'query', 'số dư BIDV': 'query', 'tháng 9 thu chi thế nào': 'query', '5 giao dịch gần nhất': 'query',
    'chia lương 20tr': 'advice', 'cần tiết kiệm 5tr mua khoá học, nên chia thế nào?': 'advice',
    'chào': 'greet', 'cảm ơn': 'thanks', 'bạn làm được gì': 'help',
  };
  for (const [m, want] of Object.entries(cases)) assert.equal(classify(m), want, m);
  const [c] = await parse('cafe 25k');
  assert.equal(c.type, 'expense'); assert.equal(c.category_name, 'Ăn uống'); assert.equal(c.amount, 25000);
  const [t] = await parse('mua 2 ly trà sữa 60k');
  assert.equal(t.amount, 60000);
  const [r] = await parse('rút 500k bidv');
  assert.equal(r.type, 'transfer'); assert.equal(r.wallet_name, 'BIDV'); assert.equal(r.to_wallet_name, 'Tiền mặt');
  const [n] = await parse('nạp 200k momo từ techcombank');
  assert.equal(n.wallet_name, 'Techcombank'); assert.equal(n.to_wallet_name, 'MoMo');
  const [q] = await parse('hôm qua 200k');
  assert.equal(q.category_name, 'Chi khác'); // "hôm qua" không bị hiểu thành "quà"
});

test('trợ lý: trả lời câu hỏi bằng dữ liệu thật', async () => {
  const { token } = await auth.register({ name: 'Q', email: 'q@example.com', password: 'abc12345', demo: true }, seedDemo);
  const ask = async (message) => (await call(token, 'POST', '/api/chat', { message })).data;
  const today = await ask('hôm nay chi bao nhiêu');
  assert.equal(today.kind, 'text'); assert.match(today.text, /Đã chi hôm nay: \*\*[\d.]+đ\*\*/);
  assert.match((await ask('số dư BIDV')).text, /Số dư \*\*BIDV\*\*/);
  assert.match((await ask('hũ hưởng thụ còn bao nhiêu')).text, /Hũ \*\*Hưởng thụ\*\*/);
  assert.match((await ask('máy ảnh còn thiếu bao nhiêu')).text, /Máy ảnh Sony/);
  assert.match((await ask('7 ngày qua chi bao nhiêu')).text, /Đã chi 7 ngày qua/);
  assert.match((await ask('tháng này tiêu nhiều nhất vào gì')).text, /Chi nhiều nhất/);
  assert.equal((await ask('chia lương 20tr')).kind, 'advice');
  assert.match((await ask('abc xyz')).text, /chưa hiểu/);
});

test('xoá dữ liệu mẫu: chỉ xoá dữ liệu mẫu, giữ dữ liệu tự nhập', async () => {
  const { token } = await auth.register({ name: 'X', email: 'x@example.com', password: 'abc12345', demo: true }, seedDemo);
  assert.equal((await call(token, 'GET', '/api/settings')).data.has_demo, true);
  const wallets = (await call(token, 'GET', '/api/wallets')).data;
  const cat = (await call(token, 'GET', '/api/categories?type=expense')).data[0];
  const mine = await call(token, 'POST', '/api/transactions', { type: 'expense', amount: 12345, wallet_id: wallets[0].id, category_id: cat.id, note: 'của tôi' });
  assert.equal(mine.status, 200);
  const goal = await call(token, 'POST', '/api/savings', { name: 'Mục tiêu thật', target_amount: 1_000_000, target_date: '2099-01-01' });

  const r = await call(token, 'DELETE', '/api/demo-data');
  assert.equal(r.status, 200); assert.equal(r.data.cleared, true); assert.ok(r.data.transactions > 50);
  const txs = (await call(token, 'GET', '/api/transactions?limit=1000')).data;
  assert.deepEqual(txs.map((t) => t.note), ['của tôi']);
  assert.deepEqual((await call(token, 'GET', '/api/savings')).data.map((g) => g.id), [goal.data.id]);
  assert.equal((await call(token, 'GET', '/api/jar-periods')).data.length, 0);
  assert.ok((await call(token, 'GET', '/api/wallets')).data.every((w) => w.initial_balance === 0));
  assert.equal((await call(token, 'GET', '/api/settings')).data.has_demo, false);
  assert.equal((await call(token, 'DELETE', '/api/demo-data')).data.cleared, false);
});

test('xoá dữ liệu mẫu ở tài khoản tạo trước khi có đánh dấu', async () => {
  const { token, user } = await auth.register({ name: 'L', email: 'legacy@example.com', password: 'abc12345', demo: true }, seedDemo);
  // giả lập dữ liệu cũ: giao dịch mẫu mang source 'manual', không có đánh dấu demo_data
  await runWithUser(user.id, () => db.prepare("UPDATE transactions SET source = 'manual' WHERE user_id = @uid").run());
  await runWithUser(user.id, () => db.prepare("DELETE FROM settings WHERE user_id = @uid AND key = 'demo_data'").run());
  const wallets = (await call(token, 'GET', '/api/wallets')).data;
  const cat = (await call(token, 'GET', '/api/categories?type=expense')).data[0];
  await runWithUser(user.id, () => db.prepare(`INSERT INTO transactions(user_id, type, amount, amount_base, wallet_id, category_id, note, date, created_at)
    VALUES (@uid, 'expense', 5000, 5000, ?, ?, 'sau này', '2026-01-01', datetime('now', '+1 day'))`).run(wallets[0].id, cat.id));

  assert.equal((await call(token, 'GET', '/api/settings')).data.has_demo, true);
  const r = await call(token, 'DELETE', '/api/demo-data');
  assert.equal(r.data.cleared, true);
  assert.deepEqual((await call(token, 'GET', '/api/transactions?limit=1000')).data.map((t) => t.note), ['sau này']);
  assert.equal((await call(token, 'GET', '/api/savings')).data.length, 0);
  assert.equal((await call(token, 'GET', '/api/jar-periods')).data.length, 0);
  assert.equal((await call(token, 'GET', '/api/settings')).data.has_demo, false);
});
