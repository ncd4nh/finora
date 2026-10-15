// Lưu trữ: 1 database libSQL/SQLite duy nhất.
//  - Chạy trên máy: file ./data/finora.db (không cần cài gì thêm)
//  - Chạy online (Vercel): Turso, đặt TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
// Mọi bảng dữ liệu cá nhân có cột user_id. Trong câu SQL, viết `@uid` để lọc theo người dùng đang đăng nhập;
// wrapper sẽ thay bằng id thật. Câu SQL chạm vào bảng cá nhân mà thiếu @uid sẽ bị chặn (tránh lộ dữ liệu).
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

const SCHEMA = `
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
  user_id    INTEGER NOT NULL,
  device     TEXT,
  last_seen  TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (user_id, key)
);

-- Hũ tiền (JARS)
CREATE TABLE IF NOT EXISTS jars (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  code        TEXT,
  percent     REAL NOT NULL DEFAULT 0,      -- % trên tổng số tiền chia (khi chia theo %)
  fixed_amount REAL,                        -- số tiền vào hũ mỗi kỳ (khi chia theo số tiền; NULL = theo %)
  color       TEXT,
  icon        TEXT,
  description TEXT,
  is_saving   INTEGER NOT NULL DEFAULT 0,  -- hũ tích luỹ: không cảnh báo tốc độ chi
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, name)
);

-- Ví tiền
CREATE TABLE IF NOT EXISTS wallets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  name            TEXT NOT NULL,
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
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, name)
);

-- Danh mục thu / chi
CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL CHECK (type IN ('income','expense')),
  jar_id   INTEGER,
  icon     TEXT,
  color    TEXT,
  aliases  TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, name, type)
);

-- Mục tiêu tiết kiệm (ngắn hạn / dài hạn)
CREATE TABLE IF NOT EXISTS savings_goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  name          TEXT NOT NULL,
  purpose       TEXT,
  target_amount REAL NOT NULL,
  start_date    TEXT NOT NULL,
  target_date   TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'short' CHECK (kind IN ('short','long')),
  wallet_id     INTEGER,              -- ví giữ tiền tiết kiệm
  jar_id        INTEGER,
  icon          TEXT,
  color         TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','cancelled')),
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON savings_goals(user_id);

-- Giao dịch
CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount          REAL NOT NULL CHECK (amount > 0),   -- theo mệnh giá ví nguồn
  amount_base     REAL NOT NULL,                      -- quy đổi VND tại thời điểm ghi
  wallet_id       INTEGER NOT NULL,
  to_wallet_id    INTEGER,
  to_amount       REAL,                               -- số tiền vào ví đích (mệnh giá ví đích)
  category_id     INTEGER,
  jar_id          INTEGER,
  savings_goal_id INTEGER,
  note            TEXT,
  date            TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'manual',     -- manual|chat|saving
  client_ref      TEXT,                               -- mã do thiết bị tạo: gửi lại không bị trùng
  exclude_balance INTEGER NOT NULL DEFAULT 0,         -- 1 = chỉ ghi nhận (đã gồm trong số dư khai báo), không cộng/trừ vào ví
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_tx_to_wallet ON transactions(to_wallet_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_client_ref ON transactions(user_id, client_ref) WHERE client_ref IS NOT NULL;

-- Nạp tiền vào mục tiêu tiết kiệm
CREATE TABLE IF NOT EXISTS savings_contributions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  goal_id        INTEGER NOT NULL,
  amount         REAL NOT NULL,              -- VND (âm = rút ra)
  date           TEXT NOT NULL,
  from_wallet_id INTEGER,
  transaction_id INTEGER,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contrib_goal ON savings_contributions(goal_id);

-- Kỳ chia hũ (từ ngày lương đến trước ngày lương kế tiếp)
CREATE TABLE IF NOT EXISTS jar_periods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  income_amount REAL NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, start_date)
);

CREATE TABLE IF NOT EXISTS jar_allocations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL,
  period_id INTEGER NOT NULL,
  jar_id    INTEGER NOT NULL,
  percent   REAL NOT NULL DEFAULT 0,
  amount    REAL NOT NULL DEFAULT 0,
  UNIQUE (period_id, jar_id)
);

-- Chuyển tiền giữa các hũ trong kỳ
CREATE TABLE IF NOT EXISTS jar_transfers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  period_id   INTEGER NOT NULL,
  from_jar_id INTEGER NOT NULL,
  to_jar_id   INTEGER NOT NULL,
  amount      REAL NOT NULL CHECK (amount > 0),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_jt_period ON jar_transfers(period_id);
`;

export const USER_TABLES = [
  'settings', 'jars', 'wallets', 'categories', 'savings_goals', 'transactions',
  'savings_contributions', 'jar_periods', 'jar_allocations', 'jar_transfers',
];
const USER_TABLE_RE = new RegExp(`\\b(${USER_TABLES.join('|')})\\b`, 'i');

// ---------- Kết nối ----------
function databaseUrl() {
  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  if (url) return url;
  const dir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
  fs.mkdirSync?.(dir, { recursive: true });
  return 'file:' + path.join(dir, 'finora.db');
}

let client = null;
let ready = null;
/**
 * Online (libsql://, https://) dùng bản "web" thuần HTTP: không cần file nhị phân, chạy tốt trên Vercel.
 * Trên máy (file:) dùng bản Node có SQLite nhúng.
 */
async function connect() {
  const url = databaseUrl();
  const mod = url.startsWith('file:') ? await import('@libsql/client') : await import('@libsql/client/web');
  client = mod.createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  await client.executeMultiple(SCHEMA);
  // DB tạo từ phiên bản cũ: bổ sung các cột mới (cột đã có thì bỏ qua)
  for (const sql of MIGRATIONS) {
    try { await client.execute(sql); } catch (e) { if (!/duplicate column/i.test(e?.message || '')) throw e; }
  }
}
const MIGRATIONS = [
  'ALTER TABLE transactions ADD COLUMN exclude_balance INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE jars ADD COLUMN fixed_amount REAL',
];
/** Kết nối + tạo bảng (1 lần cho mỗi tiến trình / lần khởi động serverless) */
export function init() {
  if (!ready) ready = connect().catch((e) => { ready = null; client = null; throw e; });
  return ready;
}
function getClient() {
  return client;
}
const isFile = () => client?.protocol === 'file';
/** Đóng kết nối (dùng cho test) */
export function closeDb() {
  client?.close();
  client = null;
  ready = null;
}

// ---------- Ngữ cảnh người dùng ----------
const als = new AsyncLocalStorage();
/** Chạy fn trong ngữ cảnh dữ liệu của người dùng */
export function runWithUser(userId, fn) {
  return als.run({ userId: Number(userId), tx: null }, fn);
}
/** id người dùng đang đăng nhập */
export function uid() {
  const id = als.getStore()?.userId;
  if (!id) throw Object.assign(new Error('Chưa đăng nhập'), { status: 401 });
  return id;
}

function bindUid(sql) {
  if (!/@uid\b/.test(sql)) {
    if (USER_TABLE_RE.test(sql)) throw new Error(`Câu SQL thiếu lọc người dùng (@uid): ${sql.slice(0, 80)}`);
    return sql;
  }
  return sql.replace(/@uid\b/g, String(uid()));
}

const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
function normArgs(a) {
  if (a.length === 1 && a[0] && typeof a[0] === 'object' && !Array.isArray(a[0]) && !(a[0] instanceof Uint8Array)) {
    return Object.fromEntries(Object.entries(a[0]).map(([k, v]) => [k, clean(v)]));
  }
  return (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map(clean);
}
const toObj = (rs) => rs.rows.map((r) => {
  const o = {};
  rs.columns.forEach((c, i) => { o[c] = r[i]; });
  return o;
});

// Giao dịch DB chạy tuần tự trong cùng tiến trình (SQLite file chỉ cho 1 người ghi tại một thời điểm)
let txQueue = Promise.resolve();

/** Các lệnh trong cùng 1 giao dịch chạy lần lượt (kể cả khi gọi bằng Promise.all) */
function inTx(st, fn) {
  const p = st.chain.then(() => fn(st.tx));
  st.chain = p.catch(() => {});
  return p;
}

async function execute(sql, args) {
  await init();
  const st = als.getStore();
  if (st?.tx) return inTx(st, (t) => t.execute({ sql: bindUid(sql), args }));
  const q = { sql: bindUid(sql), args };
  if (isFile()) await txQueue; // chờ giao dịch đang mở (SQLite file khoá khi đang ghi)
  return getClient().execute(q);
}

/**
 * Giống better-sqlite3 nhưng bất đồng bộ:
 *   await db.prepare('SELECT * FROM wallets WHERE user_id=@uid AND id=?').get(id)
 */
export const db = {
  prepare(sql) {
    return {
      get: async (...a) => toObj(await execute(sql, normArgs(a)))[0],
      all: async (...a) => toObj(await execute(sql, normArgs(a))),
      run: async (...a) => {
        const r = await execute(sql, normArgs(a));
        return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
      },
    };
  },
};

/** Ghi nhiều câu lệnh trong 1 lần gửi (nhanh khi chạy serverless). stmts: [[sql, args?], ...] */
export async function batch(stmts) {
  await init();
  const list = stmts.filter(Boolean).map(([sql, args = []]) => ({ sql: bindUid(sql), args: normArgs([args]) }));
  if (!list.length) return [];
  const st = als.getStore();
  if (st?.tx) return inTx(st, (t) => t.batch(list));
  if (isFile()) await txQueue;
  return getClient().batch(list, 'write');
}

/** Bọc fn thành giao dịch DB (lỗi -> huỷ toàn bộ). Gọi lồng nhau sẽ dùng chung giao dịch ngoài. */
export const tx = (fn) => async (...args) => {
  const store = als.getStore();
  if (store?.tx) return fn(...args);
  await init();
  const run = async () => {
    const t = await getClient().transaction('write');
    try {
      const out = await als.run({ ...(store || {}), tx: t, chain: Promise.resolve() }, () => fn(...args));
      await t.commit();
      return out;
    } catch (e) {
      await t.rollback().catch(() => {});
      throw e;
    } finally {
      t.close();
    }
  };
  if (!isFile()) return run(); // Turso tự xử lý ghi đồng thời
  const p = txQueue.then(run, run);
  txQueue = p.catch(() => {});
  return p;
};

// ---------- Settings ----------
const DEFAULT_SETTINGS = {
  salary_day: '10',
  base_currency: 'VND',
  default_wallet_id: '',
  overspend_tolerance: '0.1', // chi nhanh hơn tiến độ thời gian > 10% -> cảnh báo
  split_amount: '',           // số tiền chia hũ mặc định mỗi kỳ (trống = gợi ý theo thu nhập đã ghi)
  split_mode: 'pct',          // cách chia hũ: pct = theo %, amount = theo số tiền
};
const UPSERT_SETTING = 'INSERT INTO settings(user_id, key, value) VALUES (@uid, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value';

export async function getSettings() {
  const rows = await db.prepare('SELECT key, value FROM settings WHERE user_id = @uid').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return {
    ...s,
    salary_day: Number(s.salary_day) || 10,
    overspend_tolerance: Number(s.overspend_tolerance) || 0.1,
    default_wallet_id: s.default_wallet_id ? Number(s.default_wallet_id) : null,
    split_amount: Number(s.split_amount) > 0 ? Number(s.split_amount) : 0,
    split_mode: s.split_mode === 'amount' ? 'amount' : 'pct',
  };
}

export async function setSettings(obj) {
  await batch(Object.entries(obj)
    .filter(([k]) => k in DEFAULT_SETTINGS)
    .map(([k, v]) => [UPSERT_SETTING, [k, v == null ? '' : String(v)]]));
  return getSettings();
}

// ---------- Dữ liệu mặc định cho tài khoản mới (1 lần gửi) ----------
const DEFAULT_JARS = [
  ['Thiết yếu', 'NEC', 55, '#2a78d6', '🏠', 'Ăn uống, nhà ở, đi lại, hoá đơn', 0],
  ['Hưởng thụ', 'PLAY', 10, '#eb6834', '🎉', 'Giải trí, mua sắm cá nhân', 0],
  ['Giáo dục', 'EDU', 10, '#1baf7a', '📚', 'Sách, khoá học, phát triển bản thân', 0],
  ['Tiết kiệm dài hạn', 'LTSS', 10, '#eda100', '🐷', 'Quỹ cho mục tiêu lớn, dự phòng', 1],
  ['Tự do tài chính', 'FFA', 10, '#e87ba4', '📈', 'Đầu tư sinh lời, không tiêu', 1],
  ['Cho đi', 'GIVE', 5, '#008300', '🎁', 'Biếu tặng, từ thiện, hiếu hỉ', 0],
];
const DEFAULT_WALLETS = [
  ['Tiền mặt', 'cash', 'VND', 1, 'tien mat, cash, tm', '#64748b', '💵'],
  ['Techcombank', 'bank', 'VND', 1, 'tcb, techcom', '#e5484d', '🏦'],
  ['BIDV', 'bank', 'VND', 1, 'bidv', '#2a78d6', '🏦'],
  ['MoMo', 'ewallet', 'VND', 1, 'momo, vi momo', '#c026d3', '📱'],
  ['Chứng khoán', 'investment', 'VND', 1, 'chung khoan, ck, co phieu', '#d97706', '📈'],
  ['Crypto (USDT)', 'crypto', 'USDT', 26000, 'crypto, usdt, binance', '#1f9d55', '🪙'],
];
const DEFAULT_EXPENSE = [
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
const DEFAULT_INCOME = [
  ['Lương', '💰', 'luong, salary'],
  ['Thưởng', '🏆', 'thuong, bonus'],
  ['Lãi đầu tư', '📈', 'lai, co tuc, loi nhuan'],
  ['Làm thêm', '💼', 'lam them, freelance, du an'],
  ['Thu nhập khác', '💸', 'khac, duoc cho, hoan tien'],
];

/** Tạo hũ, ví, danh mục mặc định cho người dùng hiện tại (bỏ qua nếu đã có) */
export async function seedDefaults() {
  const has = await db.prepare('SELECT 1 FROM jars WHERE user_id = @uid LIMIT 1').get();
  if (has) return;
  await batch([
    ...DEFAULT_JARS.map((j, i) => [
      'INSERT INTO jars(user_id, name, code, percent, color, icon, description, is_saving, sort_order) VALUES (@uid,?,?,?,?,?,?,?,?)',
      [...j, i],
    ]),
    ...DEFAULT_WALLETS.map((w) => [
      'INSERT INTO wallets(user_id, name, type, currency, rate_to_base, initial_balance, aliases, color, icon) VALUES (@uid,?,?,?,?,0,?,?,?)',
      w,
    ]),
    ...DEFAULT_EXPENSE.map(([name, code, icon, aliases]) => [
      `INSERT INTO categories(user_id, name, type, jar_id, icon, aliases)
       VALUES (@uid, ?, 'expense', (SELECT id FROM jars WHERE user_id = @uid AND code = ?), ?, ?)`,
      [name, code, icon, aliases],
    ]),
    ...DEFAULT_INCOME.map(([name, icon, aliases]) => [
      "INSERT INTO categories(user_id, name, type, icon, aliases) VALUES (@uid, ?, 'income', ?, ?)",
      [name, icon, aliases],
    ]),
    [`INSERT INTO settings(user_id, key, value)
      SELECT @uid, 'default_wallet_id', CAST(id AS TEXT) FROM wallets WHERE user_id = @uid AND name = 'Tiền mặt'`],
  ]);
}

/** Xoá toàn bộ dữ liệu của người dùng hiện tại */
export async function deleteUserData() {
  await batch(USER_TABLES.map((t) => [`DELETE FROM ${t} WHERE user_id = @uid`]));
}

// ---------- Đồng bộ giữa các thiết bị ----------
// Mỗi lần dữ liệu người dùng thay đổi, tăng "phiên bản". Thiết bị khác thấy phiên bản mới -> tải lại.
export async function getSyncState() {
  const rows = await db.prepare("SELECT key, value FROM settings WHERE user_id = @uid AND key IN ('sync_version','sync_client','sync_at')").all();
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { version: Number(m.sync_version || 0), client: m.sync_client || null, at: m.sync_at || null };
}
export async function bumpSync(clientId) {
  const [, , , r] = await batch([
    [`INSERT INTO settings(user_id, key, value) VALUES (@uid, 'sync_version', '1')
      ON CONFLICT(user_id, key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`],
    [UPSERT_SETTING, ['sync_client', clientId || '']],
    [UPSERT_SETTING, ['sync_at', new Date().toISOString()]],
    ["SELECT value FROM settings WHERE user_id = @uid AND key = 'sync_version'"],
  ]);
  return Number(r.rows[0]?.[0] || 0);
}
