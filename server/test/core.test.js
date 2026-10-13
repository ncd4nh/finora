// Chạy: npm test  (dùng thư mục dữ liệu tạm)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'finora-'));
const { runWithUser } = await import('../src/db.js');
const { parseMessage } = await import('../src/services/parser.js');
const { getPeriod, parseAmount } = await import('../src/utils.js');
const auth = await import('../src/services/auth.js');
const { devOutbox } = await import('../src/services/mailer.js');
const inUser = (fn) => runWithUser(999, fn);
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

test('công thức chuẩn', () => {
  const [a, b] = inUser(() => parseMessage('Chi 100k Đồ ăn Techcombank, Thu 500K BIDV'));
  assert.equal(a.type, 'expense'); assert.equal(a.amount, 100000);
  assert.equal(a.category_name, 'Ăn uống'); assert.equal(a.wallet_name, 'Techcombank');
  assert.equal(b.type, 'income'); assert.equal(b.amount, 500000); assert.equal(b.wallet_name, 'BIDV');
});

test('câu tự nhiên', () => {
  const [a, b] = inUser(() => parseMessage('Hôm nay dùng ví (Techcombank) mua đồ ăn hết 100k, hôm nay nhận lương ở ví BIDV được 500k'));
  assert.equal(a.formula, 'Chi 100k Ăn uống Techcombank');
  assert.equal(b.formula, 'Thu 500k Lương BIDV');
});

test('chuyển ví', () => {
  const [t] = inUser(() => parseMessage('Chuyển 2tr Techcombank BIDV'));
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

test('dữ liệu tách riêng theo người dùng', async () => {
  const a = await auth.register({ name: 'A', email: 'a@example.com', password: 'abc12345' });
  const b = await auth.register({ name: 'B', email: 'b@example.com', password: 'abc12345' });
  const { db } = await import('../src/db.js');
  runWithUser(a.user.id, () => db.prepare("UPDATE wallets SET initial_balance = 777 WHERE name = 'BIDV'").run());
  const va = runWithUser(a.user.id, () => db.prepare("SELECT initial_balance v FROM wallets WHERE name='BIDV'").get().v);
  const vb = runWithUser(b.user.id, () => db.prepare("SELECT initial_balance v FROM wallets WHERE name='BIDV'").get().v);
  assert.equal(va, 777); assert.equal(vb, 0);
});

test('đồng bộ: phiên bản tăng khi đổi dữ liệu, gửi lại không trùng', async () => {
  const { user } = await auth.register({ name: 'Sync', email: 'sync@example.com', password: 'abc12345' }, null, 'iPhone · Safari');
  const { getSyncState, bumpSync, db } = await import('../src/db.js');
  const { createTransaction } = await import('../src/services/finance.js');
  runWithUser(user.id, () => {
    const v0 = getSyncState().version;
    bumpSync('tab-A');
    const s = getSyncState();
    assert.equal(s.version, v0 + 1); assert.equal(s.client, 'tab-A');
    const w = db.prepare("SELECT id FROM wallets WHERE name='BIDV'").get().id;
    const c = db.prepare("SELECT id FROM categories WHERE type='expense' LIMIT 1").get().id;
    const t1 = createTransaction({ type: 'expense', amount: 50000, wallet_id: w, category_id: c, client_ref: 'ref-123' });
    const t2 = createTransaction({ type: 'expense', amount: 50000, wallet_id: w, category_id: c, client_ref: 'ref-123' });
    assert.equal(t1.id, t2.id);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM transactions WHERE client_ref='ref-123'").get().n, 1);
  });
});

test('thiết bị: liệt kê và đăng xuất thiết bị khác', async () => {
  await auth.register({ name: 'D', email: 'dev@example.com', password: 'abc12345' }, null, 'Windows · Chrome');
  const phone = await auth.login({ email: 'dev@example.com', password: 'abc12345' }, 'iPhone · Safari');
  const me = await auth.userFromToken(phone.token);
  const list = auth.listSessions(me);
  assert.equal(list.length, 2);
  assert.equal(list.find((s) => s.current).device, 'iPhone · Safari');
  const other = list.find((s) => !s.current);
  auth.revokeSession(me, other.id);
  assert.equal(auth.listSessions(me).length, 1);
});
