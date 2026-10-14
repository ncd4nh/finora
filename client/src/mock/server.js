// "Server" chạy ngay trong trình duyệt: dùng lại nguyên routes + services của backend thật
import api from '../../../server/src/routes/api.js';
import authRoutes from '../../../server/src/routes/auth.js';
import { requireAuth, register } from '../../../server/src/services/auth.js';
import { db } from '../../../server/src/db.js';
import { seedDemo } from '../../../server/src/demoData.js';
import { resetMockDb } from '@libsql/client';

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// Tài khoản dùng thử có sẵn dữ liệu mẫu
const ready = (async () => {
  if (!(await db.prepare('SELECT 1 FROM users WHERE email = ?').get('demo@finora.vn'))) {
    await register({ name: 'Bạn Ong', email: 'demo@finora.vn', password: 'finora123', demo: true }, seedDemo);
  }
})();

function match(router, method, path) {
  const route = router.routes.find((r) => r.method === method && r.re.test(path));
  if (!route) return null;
  const m = path.match(route.re);
  return { route, params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
}

export async function handle(method, url, body, headers = {}) {
  await ready;
  const [path, qs] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  let found;
  let chain;
  if (path.startsWith('/auth/')) {
    found = match(authRoutes, method, path.slice(5));
    chain = found && found.route.handlers;
  } else {
    found = match(api, method, path);
    chain = found && [requireAuth, ...found.route.handlers];
  }
  if (!found) return { status: 404, data: { error: `Không có API ${path}` } };
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { method, path, route: { path: found.route.path }, params: found.params, query, body: clone(body) ?? {}, headers: lower };
  return new Promise((resolve) => {
    const res = { json: (d) => resolve({ status: 200, data: clone(d) }), status: () => res };
    const fail = (err) => {
      let msg = err?.message || 'Lỗi';
      if (/UNIQUE constraint/.test(msg)) msg = 'Tên đã tồn tại';
      resolve({ status: err?.status || 400, data: { error: msg } });
    };
    let i = 0;
    const next = (err) => {
      if (err) return fail(err);
      const fn = chain[i++];
      if (!fn) return;
      try {
        const r = fn(req, res, next);
        if (r && typeof r.catch === 'function') r.catch(fail);
      } catch (e) { fail(e); }
    };
    next();
  });
}

export function resetDemo() {
  resetMockDb();
  location.hash = '#/login';
  location.reload();
}

globalThis.__MOCK_RESET = resetDemo;
globalThis.__MOCK_RESOLVE(handle);
