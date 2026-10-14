// Giả lập @libsql/client trên nền sql.js (SQLite WebAssembly), lưu DB vào localStorage
const KEY = 'finora-db2:main';
const OLD_PREFIX = 'finora-db:';
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

class MockDb {
  constructor() {
    let data = null;
    try { const s = localStorage.getItem(KEY); if (s) data = b64ToBytes(s); } catch { /* không có storage */ }
    try { this.raw = data ? new SQL.Database(data) : new SQL.Database(); } catch { this.raw = new SQL.Database(); }
    this.depth = 0;
    this.sp = 0;
    // Mở nhiều tab = nhiều "thiết bị": tab khác lưu DB -> nạp lại bản mới để thấy dữ liệu đồng bộ
    try {
      window.addEventListener('storage', (e) => {
        if (e.key !== KEY || !e.newValue || this.depth) return;
        clearTimeout(this.timer);
        try { this.raw.close(); } catch { /* bỏ qua */ }
        this.raw = new SQL.Database(b64ToBytes(e.newValue));
      });
    } catch { /* bỏ qua */ }
  }
  run(stmt) {
    const { sql, args } = typeof stmt === 'string' ? { sql: stmt, args: [] } : stmt;
    let params = args || [];
    if (!Array.isArray(params)) {
      const o = {};
      for (const [k, v] of Object.entries(params)) o['@' + k] = v;
      params = o;
    }
    const st = this.raw.prepare(sql);
    const rows = [];
    let columns = [];
    try {
      st.bind(params);
      while (st.step()) rows.push(st.get());
      columns = st.getColumnNames();
    } finally { st.free(); }
    const rowsAffected = this.raw.getRowsModified();
    const lastInsertRowid = BigInt(this.raw.exec('SELECT last_insert_rowid()')[0].values[0][0]);
    if (!/^\s*select/i.test(sql)) this.dirty();
    return { columns, rows, rowsAffected, lastInsertRowid };
  }
  begin() {
    const name = 'sp' + ++this.sp;
    this.raw.run(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
    this.depth++;
    return name;
  }
  end(name, ok) {
    this.depth--;
    if (ok) this.raw.run(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    else if (this.depth === 0) this.raw.run('ROLLBACK');
    else { this.raw.run(`ROLLBACK TO ${name}`); this.raw.run(`RELEASE ${name}`); }
    this.dirty();
  }
  dirty() {
    if (this.depth) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 400);
  }
  save() {
    try { localStorage.setItem(KEY, bytesToB64(this.raw.export())); } catch { /* bỏ qua */ }
  }
}

let shared = null;
export function createClient() {
  const d = (shared ||= new MockDb());
  globalThis.__MOCK_DB = d;
  const batch = async (stmts) => {
    const name = d.begin();
    try {
      const out = stmts.map((s) => d.run(s));
      d.end(name, true);
      return out;
    } catch (e) {
      d.end(name, false);
      throw e;
    }
  };
  return {
    protocol: 'mock',
    execute: async (stmt) => d.run(stmt),
    batch,
    executeMultiple: async (sql) => { d.raw.exec(sql); d.dirty(); },
    async transaction() {
      const name = d.begin();
      let open = true;
      return {
        execute: async (stmt) => d.run(stmt),
        batch: async (stmts) => stmts.map((s) => d.run(s)),
        commit: async () => { if (open) { open = false; d.end(name, true); } },
        rollback: async () => { if (open) { open = false; d.end(name, false); } },
        close: () => { if (open) { open = false; d.end(name, false); } },
      };
    },
    close: () => d.save(),
  };
}

export function resetMockDb() {
  try {
    Object.keys(localStorage)
      .filter((k) => k === KEY || k.startsWith(OLD_PREFIX) || k.startsWith('tcx-proto') || k === 'finora-token')
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* bỏ qua */ }
}
