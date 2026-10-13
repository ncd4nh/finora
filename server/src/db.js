// Lưu trữ: 1 file SQLite cho tài khoản (auth.db) + 1 file SQLite riêng cho dữ liệu mỗi người dùng (users/<id>.db).
// Code nghiệp vụ dùng `db` như trước: `db` là proxy trỏ tới DB của người dùng đang đăng nhập (AsyncLocalStorage).
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(path.join(DATA_DIR, 'users'), { recursive: true });

const USER_SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Hũ tiền (JARS)
CREATE TABLE IF NOT EXISTS jars (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  code        TEXT,
  percent     REAL NOT NULL DEFAULT 0,
  color       TEXT,
  icon        TEXT,
  description TEXT,
  is_saving   INTEGER NOT NULL DEFAULT 0,  -- hũ tích luỹ: không cảnh báo tốc độ chi
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0
);

-- Ví tiền
CREATE TABLE IF NOT EXISTS wallets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL DEFAULT 'bank',   -- bank|cash|ewallet|investment|crypto|other
  currency        TEXT NOT NULL DEFAULT 'VND',    -- mệnh giá: VND, USD, USDT, BTC, ...
  rate_to_base    REAL NOT NULL DEFAULT 1,        -- tỷ giá quy đổi 1 đơn vị -> VND
  initial_balance REAL NOT NULL DEFAULT 0,
  aliases         TEXT NOT NULL DEFAULT '',       -- tên gọi tắt cho chat, cách nhau dấu phẩy
  color           TEXT,
  icon            TEXT,
  include_in_total INTEGER NOT NULL DEFAULT 1,
  archived        INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Danh mục thu / chi
CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL CHECK (type IN ('income','expense')),
  jar_id   INTEGER REFERENCES jars(id) ON DELETE SET NULL,
  icon     TEXT,
  color    TEXT,
  aliases  TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE (name, type)
);

-- Mục tiêu tiết kiệm (ngắn hạn / dài hạn)
CREATE TABLE IF NOT EXISTS savings_goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  purpose       TEXT,
  target_amount REAL NOT NULL,
  start_date    TEXT NOT NULL,
  target_date   TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'short' CHECK (kind IN ('short','long')),
  wallet_id     INTEGER REFERENCES wallets(id) ON DELETE SET NULL, -- ví giữ tiền tiết kiệm
  jar_id        INTEGER REFERENCES jars(id) ON DELETE SET NULL,
  icon          TEXT,
  color         TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','cancelled')),
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Giao dịch
CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount          REAL NOT NULL CHECK (amount > 0),   -- theo mệnh giá ví nguồn
  amount_base     REAL NOT NULL,                      -- quy đổi VND tại thời điểm ghi
  wallet_id       INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  to_wallet_id    INTEGER REFERENCES wallets(id) ON DELETE CASCADE,
  to_amount       REAL,                               -- số tiền vào ví đích (mệnh giá ví đích)
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  jar_id          INTEGER REFERENCES jars(id) ON DELETE SET NULL,
  savings_goal_id INTEGER REFERENCES savings_goals(id) ON DELETE SET NULL,
  note            TEXT,
  date            TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'manual',     -- manual|chat|saving
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transactions(wallet_id);

-- Nạp tiền vào mục tiêu tiết kiệm
CREATE TABLE IF NOT EXISTS savings_contributions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id        INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  amount         REAL NOT NULL,              -- VND (âm = rút ra)
  date           TEXT NOT NULL,
  from_wallet_id INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Kỳ chia hũ (từ ngày lương đến trước ngày lương kế tiếp)
CREATE TABLE IF NOT EXISTS jar_periods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date    TEXT NOT NULL UNIQUE,
  end_date      TEXT NOT NULL,
  income_amount REAL NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jar_allocations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER NOT NULL REFERENCES jar_periods(id) ON DELETE CASCADE,
  jar_id    INTEGER NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
  percent   REAL NOT NULL DEFAULT 0,
  amount    REAL NOT NULL DEFAULT 0,
  UNIQUE (period_id, jar_id)
);

-- Chuyển tiền giữa các hũ trong kỳ
CREATE TABLE IF NOT EXISTS jar_transfers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id   INTEGER NOT NULL REFERENCES jar_periods(id) ON DELETE CASCADE,
  from_jar_id INTEGER NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
  to_jar_id   INTEGER NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
  amount      REAL NOT NULL CHECK (amount > 0),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar        TEXT,                 -- ảnh đại diện (data URL 256px) hoặc emoji
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,        -- chỉ lưu SHA-256 của token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

export const authDb = new Database(path.join(DATA_DIR, 'auth.db'));
authDb.pragma('journal_mode = WAL');
authDb.pragma('foreign_keys = ON');
authDb.exec(AUTH_SCHEMA);

/** Thêm cột nếu DB cũ chưa có (nâng cấp không mất dữ liệu) */
function ensureColumn(d, table, col, type) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}
ensureColumn(authDb, 'sessions', 'device', 'TEXT');
ensureColumn(authDb, 'sessions', 'last_seen', 'TEXT');

export const userDbPath = (userId) => path.join(DATA_DIR, 'users', `${Number(userId)}.db`);
export const legacyDbPath = () => process.env.DB_PATH || path.join(DATA_DIR, 'finance.db');

const cache = new Map();
/** Mở (và khởi tạo nếu mới) DB dữ liệu của 1 người dùng */
export function openUserDb(userId) {
  const key = Number(userId);
  if (cache.has(key)) return cache.get(key);
  const d = new Database(userDbPath(key));
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.exec(USER_SCHEMA);
  // mã do thiết bị tạo cho mỗi giao dịch: gửi lại (khi mạng chập chờn / hàng chờ offline) không bị trùng
  ensureColumn(d, 'transactions', 'client_ref', 'TEXT');
  d.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_client_ref ON transactions(client_ref) WHERE client_ref IS NOT NULL');
  seed(d);
  cache.set(key, d);
  return d;
}
export function closeUserDb(userId) {
  const d = cache.get(Number(userId));
  if (d) { d.close?.(); cache.delete(Number(userId)); }
}

const als = new AsyncLocalStorage();
/** Chạy fn trong ngữ cảnh dữ liệu của người dùng */
export function runWithUser(userId, fn) {
  return als.run(openUserDb(userId), fn);
}
function currentDb() {
  const d = als.getStore();
  if (!d) throw Object.assign(new Error('Chưa đăng nhập'), { status: 401 });
  return d;
}
/** DB của người dùng hiện tại */
export const db = new Proxy({}, {
  get(_t, prop) {
    const d = currentDb();
    const v = d[prop];
    return typeof v === 'function' ? v.bind(d) : v;
  },
});
/** Giao dịch DB, tự chọn DB của người dùng hiện tại lúc gọi */
export const tx = (fn) => (...args) => currentDb().transaction(fn)(...args);


// ---------- Settings ----------
const DEFAULT_SETTINGS = {
  salary_day: '10',
  base_currency: 'VND',
  default_wallet_id: '',
  overspend_tolerance: '0.1', // chi nhanh hơn tiến độ thời gian > 10% -> cảnh báo
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return {
    ...s,
    salary_day: Number(s.salary_day) || 10,
    overspend_tolerance: Number(s.overspend_tolerance) || 0.1,
    default_wallet_id: s.default_wallet_id ? Number(s.default_wallet_id) : null,
  };
}

export function setSettings(obj, d = db) {
  const st = d.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const run = d.transaction((o) => {
    for (const [k, v] of Object.entries(o)) {
      if (k in DEFAULT_SETTINGS) st.run(k, v == null ? '' : String(v));
    }
  });
  run(obj);
  return d === db ? getSettings() : null;
}

// ---------- Seed dữ liệu mặc định ----------
function seed(db) {
  const hasJar = db.prepare('SELECT COUNT(*) c FROM jars').get().c > 0;
  if (hasJar) return;

  const insJar = db.prepare(
    'INSERT INTO jars(name, code, percent, color, icon, description, is_saving, sort_order) VALUES (?,?,?,?,?,?,?,?)'
  );
  const jars = [
    ['Thiết yếu', 'NEC', 55, '#2a78d6', '🏠', 'Ăn uống, nhà ở, đi lại, hoá đơn', 0],
    ['Hưởng thụ', 'PLAY', 10, '#eb6834', '🎉', 'Giải trí, mua sắm cá nhân', 0],
    ['Giáo dục', 'EDU', 10, '#1baf7a', '📚', 'Sách, khoá học, phát triển bản thân', 0],
    ['Tiết kiệm dài hạn', 'LTSS', 10, '#eda100', '🐷', 'Quỹ cho mục tiêu lớn, dự phòng', 1],
    ['Tự do tài chính', 'FFA', 10, '#e87ba4', '📈', 'Đầu tư sinh lời, không tiêu', 1],
    ['Cho đi', 'GIVE', 5, '#008300', '🎁', 'Biếu tặng, từ thiện, hiếu hỉ', 0],
  ];
  const jarId = {};
  jars.forEach((j, i) => {
    jarId[j[1]] = insJar.run(...j, i).lastInsertRowid;
  });

  const insWallet = db.prepare(
    'INSERT INTO wallets(name, type, currency, rate_to_base, initial_balance, aliases, color, icon) VALUES (?,?,?,?,?,?,?,?)'
  );
  const cash = insWallet.run('Tiền mặt', 'cash', 'VND', 1, 0, 'tien mat, cash, tm', '#64748b', '💵').lastInsertRowid;
  insWallet.run('Techcombank', 'bank', 'VND', 1, 0, 'tcb, techcom', '#e5484d', '🏦');
  insWallet.run('BIDV', 'bank', 'VND', 1, 0, 'bidv', '#2a78d6', '🏦');
  insWallet.run('MoMo', 'ewallet', 'VND', 1, 0, 'momo, vi momo', '#c026d3', '📱');
  insWallet.run('Chứng khoán', 'investment', 'VND', 1, 0, 'chung khoan, ck, co phieu', '#d97706', '📈');
  insWallet.run('Crypto (USDT)', 'crypto', 'USDT', 26000, 0, 'crypto, usdt, binance', '#1f9d55', '🪙');

  const insCat = db.prepare('INSERT INTO categories(name, type, jar_id, icon, aliases) VALUES (?,?,?,?,?)');
  const expense = [
    ['Ăn uống', 'NEC', '🍜', 'do an, an uong, an trua, an sang, an toi, cafe, ca phe, tra sua, com, bun, pho, nha hang'],
    ['Đi chợ', 'NEC', '🛒', 'di cho, sieu thi, thuc pham, rau'],
    ['Đi lại', 'NEC', '🛵', 'xang, grab, taxi, gui xe, be, xe om, ve xe, di lai'],
    ['Nhà ở', 'NEC', '🏠', 'tien nha, thue nha, tien phong'],
    ['Hoá đơn', 'NEC', '💡', 'dien, nuoc, internet, wifi, dien thoai, hoa don, nap the'],
    ['Sức khoẻ', 'NEC', '💊', 'thuoc, kham benh, bao hiem, benh vien'],
    ['Mua sắm', 'PLAY', '🛍️', 'mua sam, quan ao, giay, shopee, lazada, tiki'],
    ['Giải trí', 'PLAY', '🎬', 'xem phim, du lich, game, karaoke, giai tri, nhau'],
    ['Học tập', 'EDU', '📚', 'sach, khoa hoc, hoc phi, hoc'],
    ['Hiếu hỉ & Biếu tặng', 'GIVE', '🎁', 'dam cuoi, dam hieu, sinh nhat, qua, bieu, tu thien, mung'],
    ['Gia đình', 'NEC', '👨‍👩‍👧', 'gia dinh, bo me, con cai'],
    ['Đầu tư', 'FFA', '📈', 'mua co phieu, mua coin, dau tu'],
    ['Chi khác', 'NEC', '📦', 'khac, linh tinh'],
  ];
  for (const [name, code, icon, aliases] of expense) insCat.run(name, 'expense', jarId[code], icon, aliases);
  const income = [
    ['Lương', '💰', 'luong, salary'],
    ['Thưởng', '🏆', 'thuong, bonus'],
    ['Lãi đầu tư', '📈', 'lai, co tuc, loi nhuan'],
    ['Làm thêm', '💼', 'lam them, freelance, du an'],
    ['Thu nhập khác', '💸', 'khac, duoc cho, hoan tien'],
  ];
  for (const [name, icon, aliases] of income) insCat.run(name, 'income', null, icon, aliases);

  setSettings({ default_wallet_id: cash }, db);
}


// ---------- Đồng bộ giữa các thiết bị ----------
// Mỗi lần dữ liệu người dùng thay đổi, tăng "phiên bản". Thiết bị khác thấy phiên bản mới -> tải lại.
export function getSyncState() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('sync_version','sync_client','sync_at')").all();
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { version: Number(m.sync_version || 0), client: m.sync_client || null, at: m.sync_at || null };
}
export function bumpSync(clientId) {
  const next = getSyncState().version + 1;
  const up = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  up.run('sync_version', String(next));
  up.run('sync_client', clientId || '');
  up.run('sync_at', new Date().toISOString());
  return next;
}
