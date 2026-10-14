// Tài khoản: đăng ký, đăng nhập, phiên, đổi mật khẩu, quên mật khẩu
import { db, batch, runWithUser, seedDefaults, deleteUserData } from '../db.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from './security.js';
import { sendMail, resetLink } from './mailer.js';
import { HttpError } from './finance.js';

const SESSION_DAYS = 30;
const RESET_MINUTES = 30;
const iso = (d) => d.toISOString();
const later = (ms) => iso(new Date(Date.now() + ms));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, avatar: u.avatar, created_at: u.created_at };

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Mật khẩu cần tối thiểu 8 ký tự');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new HttpError(400, 'Mật khẩu cần có cả chữ và số');
}
function normEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new HttpError(400, 'Email không hợp lệ');
  return e;
}

// Giới hạn số lần thử (chống dò mật khẩu / spam email)
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Bạn thử quá nhiều lần, vui lòng đợi ít phút');
  arr.push(now);
  hits.set(key, arr);
}

async function createSession(userId, device) {
  const token = randomToken();
  await db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at, device, last_seen) VALUES (?,?,?,?,?)')
    .run(await sha256(token), userId, later(SESSION_DAYS * 864e5), String(device || 'Thiết bị không rõ').slice(0, 80), iso(new Date()));
  return token;
}

export async function register({ name, email, password, demo }, seedDemo, device) {
  email = normEmail(email);
  name = String(name || '').trim();
  if (!name) throw new HttpError(400, 'Vui lòng nhập tên hiển thị');
  checkPassword(password);
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Email này đã có tài khoản');
  let id;
  try {
    id = (await db.prepare('INSERT INTO users(email, name, password_hash) VALUES (?,?,?)')
      .run(email, name, await hashPassword(password))).lastInsertRowid;
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) throw new HttpError(409, 'Email này đã có tài khoản');
    throw e;
  }
  await runWithUser(id, async () => {
    await seedDefaults();
    if (demo && seedDemo) await seedDemo();
  });
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return { token: await createSession(id, device), user: publicUser(user) };
}

export async function login({ email, password }, device) {
  email = normEmail(email);
  rateLimit(`login:${email}`, 8, 15 * 60e3);
  const u = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !(await verifyPassword(String(password || ''), u.password_hash))) throw new HttpError(401, 'Email hoặc mật khẩu không đúng');
  hits.delete(`login:${email}`);
  return { token: await createSession(u.id, device), user: publicUser(u) };
}

export async function userFromToken(token) {
  if (!token) return null;
  const row = await db.prepare(
    `SELECT u.*, s.token_hash, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`
  ).get(await sha256(token), iso(new Date()));
  return row || null;
}

/** Middleware: bắt buộc đăng nhập, gắn req.user và chạy trong ngữ cảnh dữ liệu của người dùng */
export async function requireAuth(req, res, next) {
  try {
    const h = req.headers?.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    const user = await userFromToken(token);
    if (!user) return next(new HttpError(401, 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại'));
    req.user = user;
    // cập nhật "hoạt động lần cuối" (tối đa 1 lần / 5 phút)
    if (!user.last_seen || Date.now() - Date.parse(user.last_seen) > 5 * 60e3) {
      await db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(iso(new Date()), user.token_hash);
    }
    runWithUser(user.id, () => next());
  } catch (e) {
    next(e);
  }
}

export async function logout(user) {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(user.token_hash);
}

export async function updateProfile(user, { name, email, avatar }) {
  const fields = {};
  if (name !== undefined) {
    fields.name = String(name).trim();
    if (!fields.name) throw new HttpError(400, 'Tên không được để trống');
  }
  if (email !== undefined) {
    fields.email = normEmail(email);
    const other = await db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(fields.email, user.id);
    if (other) throw new HttpError(409, 'Email này đã được dùng');
  }
  if (avatar !== undefined) {
    if (avatar && (typeof avatar !== 'string' || avatar.length > 400_000)) throw new HttpError(400, 'Ảnh quá lớn (tối đa ~300KB)');
    if (avatar && !/^data:image\/(png|jpeg|webp);base64,/.test(avatar) && [...avatar].length > 4) throw new HttpError(400, 'Ảnh không hợp lệ');
    fields.avatar = avatar || null;
  }
  if (Object.keys(fields).length) {
    await db.prepare(`UPDATE users SET ${Object.keys(fields).map((k) => `${k}=@${k}`).join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=@id`)
      .run({ ...fields, id: user.id });
  }
  return publicUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
}

export async function changePassword(user, { current, next: nextPw }) {
  if (!(await verifyPassword(String(current || ''), user.password_hash))) throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
  checkPassword(nextPw);
  if (current === nextPw) throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu cũ');
  await batch([
    ['UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [await hashPassword(nextPw), user.id]],
    // Đăng xuất các thiết bị khác, giữ phiên hiện tại
    ['DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [user.id, user.token_hash]],
  ]);
  return { ok: true };
}

export async function forgotPassword({ email }) {
  email = normEmail(email);
  rateLimit(`forgot:${email}`, 3, 15 * 60e3);
  const u = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Luôn trả cùng 1 thông báo để không lộ email nào có tài khoản
  const result = { ok: true, message: 'Nếu email có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu. Liên kết có hiệu lực 30 phút.' };
  if (!u) return result;
  const token = randomToken();
  await db.prepare('INSERT INTO password_resets(token_hash, user_id, expires_at) VALUES (?,?,?)')
    .run(await sha256(token), u.id, later(RESET_MINUTES * 60e3));
  const link = resetLink(token);
  await sendMail({
    to: u.email,
    subject: 'Finora · Đặt lại mật khẩu',
    text: `Chào ${u.name},\n\nBấm vào liên kết sau để đặt mật khẩu mới (hiệu lực ${RESET_MINUTES} phút):\n${link}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.\n\n🐝 Finora — Stay focus, be present`,
    html: `<p>Chào ${u.name.replace(/</g, '&lt;')},</p><p>Bấm nút dưới để đặt mật khẩu mới (hiệu lực ${RESET_MINUTES} phút):</p>
<p><a href="${link}" style="background:#5c9442;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">Đặt lại mật khẩu</a></p>
<p style="color:#888">Nếu bạn không yêu cầu, hãy bỏ qua email này.</p><p>🐝 Finora — Stay focus, be present</p>`,
  });
  return result;
}

export async function resetPassword({ token, password }) {
  if (!token) throw new HttpError(400, 'Thiếu mã đặt lại');
  checkPassword(password);
  const row = await db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(await sha256(token));
  if (!row || row.used_at || row.expires_at < iso(new Date())) throw new HttpError(400, 'Liên kết đã hết hạn hoặc đã được dùng. Hãy yêu cầu lại.');
  await batch([
    ['UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [await hashPassword(password), row.user_id]],
    ['UPDATE password_resets SET used_at = ? WHERE token_hash = ?', [iso(new Date()), row.token_hash]],
    ['DELETE FROM sessions WHERE user_id = ?', [row.user_id]],
  ]);
  return { ok: true, message: 'Đã đặt mật khẩu mới. Hãy đăng nhập lại.' };
}

export async function deleteAccount(user) {
  await runWithUser(user.id, () => deleteUserData());
  await batch([
    ['DELETE FROM sessions WHERE user_id = ?', [user.id]],
    ['DELETE FROM password_resets WHERE user_id = ?', [user.id]],
    ['DELETE FROM users WHERE id = ?', [user.id]],
  ]);
}

// ---------- Thiết bị đang đăng nhập ----------
export async function listSessions(user) {
  const rows = await db
    .prepare('SELECT rowid AS id, token_hash, device, created_at, last_seen, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC')
    .all(user.id, iso(new Date()));
  return rows.map(({ token_hash, ...s }) => ({ ...s, current: token_hash === user.token_hash }));
}
export async function revokeSession(user, id) {
  const r = await db.prepare('DELETE FROM sessions WHERE rowid = ? AND user_id = ? AND token_hash <> ?').run(Number(id), user.id, user.token_hash);
  if (!r.changes) throw new HttpError(404, 'Không tìm thấy thiết bị (hoặc đó là thiết bị đang dùng)');
  return { ok: true };
}
export async function revokeOtherSessions(user) {
  const r = await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(user.id, user.token_hash);
  return { ok: true, count: r.changes };
}
