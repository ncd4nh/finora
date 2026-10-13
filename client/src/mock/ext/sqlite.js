// Giả lập API better-sqlite3 trên nền sql.js (SQLite WebAssembly), lưu DB vào localStorage
const PREFIX = 'finora-db:';
const b64ToBytes = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const SQL = await window.initSqlJs({ wasmBinary: b64ToBytes(window.__SQL_WASM_B64) });
const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; }
  _params(args) {
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const o = {};
      for (const [k, v] of Object.entries(args[0])) o['@' + k] = norm(v);
      return o;
    }
    return args.map(norm);
  }
  all(...args) {
    const st = this.db.raw.prepare(this.sql);
    try {
      st.bind(this._params(args));
      const rows = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    } finally { st.free(); }
  }
  get(...args) { return this.all(...args)[0]; }
  run(...args) {
    const st = this.db.raw.prepare(this.sql);
    try { st.bind(this._params(args)); st.step(); } finally { st.free(); }
    const changes = this.db.raw.getRowsModified();
    const lastInsertRowid = this.db.raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
    this.db._dirty();
    return { changes, lastInsertRowid };
  }
}

export default class Database {
  constructor(file = 'main') {
    this.key = PREFIX + file;
    let data = null;
    try { const s = localStorage.getItem(this.key); if (s) data = b64ToBytes(s); } catch { /* không có storage */ }
    try { this.raw = data ? new SQL.Database(data) : new SQL.Database(); } catch { this.raw = new SQL.Database(); }
    this.depth = 0;
    this.sp = 0;
    this.raw.run('PRAGMA foreign_keys = ON');
    // Mở nhiều tab = nhiều "thiết bị": tab khác lưu DB -> nạp lại bản mới để thấy dữ liệu đồng bộ
    try {
      window.addEventListener('storage', (e) => {
        if (e.key !== this.key || !e.newValue || this.depth) return;
        clearTimeout(this.timer);
        try { this.raw.close(); } catch { /* bỏ qua */ }
        this.raw = new SQL.Database(b64ToBytes(e.newValue));
        this.raw.run('PRAGMA foreign_keys = ON');
      });
    } catch { /* bỏ qua */ }
    globalThis.__MOCK_DB = this;
  }
  pragma() {}
  exec(sql) { this.raw.exec(sql); this._dirty(); }
  prepare(sql) { return new Statement(this, sql); }
  transaction(fn) {
    const self = this;
    return function (...args) {
      const name = 'sp' + ++self.sp;
      self.raw.run(self.depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
      self.depth++;
      try {
        const r = fn.apply(this, args);
        self.depth--;
        self.raw.run(self.depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
        self._dirty();
        return r;
      } catch (e) {
        self.depth--;
        if (self.depth === 0) self.raw.run('ROLLBACK');
        else { self.raw.run(`ROLLBACK TO ${name}`); self.raw.run(`RELEASE ${name}`); }
        throw e;
      }
    };
  }
  _dirty() {
    if (this.depth) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 400);
  }
  save() {
    try {
      const bytes = this.raw.export();
      this.raw.run('PRAGMA foreign_keys = ON'); // export() mở lại DB
      localStorage.setItem(this.key, bytesToB64(bytes));
    } catch { /* bỏ qua */ }
  }
  close() { this.save(); }
  static reset() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) || k.startsWith('tcx-proto') || k === 'finora-token').forEach((k) => localStorage.removeItem(k));
    } catch { /* bỏ qua */ }
  }
}
