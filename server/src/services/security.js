// Băm mật khẩu (scrypt) và token ngẫu nhiên
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64'), 64);
  const expected = Buffer.from(hash, 'base64');
  return expected.length === key.length && crypto.timingSafeEqual(key, expected);
}

export function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export async function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}
