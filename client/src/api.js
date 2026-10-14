// Gọi API backend (kèm token đăng nhập). Bản prototype: gọi "server" chạy ngay trong trình duyệt.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN_KEY = 'finora-token';
const OUTBOX_KEY = 'finora-outbox';
// Mặc định giao diện và API cùng domain (Vercel). Nếu để API ở nơi khác: đặt VITE_API_URL=https://api-cua-ban.example.com
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const rid = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export const tokenStore = {
  get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* bỏ qua */ } },
};

/** Mã riêng của tab/thiết bị này: server ghi lại ai vừa đổi dữ liệu để thiết bị khác biết mà tải lại */
export const CLIENT_ID = (() => {
  try {
    let id = sessionStorage.getItem('finora-client');
    if (!id) { id = rid(); sessionStorage.setItem('finora-client', id); }
    return id;
  } catch { return rid(); }
})();

/** Tên thiết bị dễ đọc, VD "iPhone · Safari" (hiện trong danh sách thiết bị đăng nhập) */
export function deviceLabel() {
  const ua = navigator.userAgent || '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Thiết bị';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt';
  return `${os} · ${br}`;
}

async function req(method, url, body) {
  const token = tokenStore.get();
  const headers = { 'X-Client-Id': CLIENT_ID, 'X-Device': deviceLabel() };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let status, data;
  if (globalThis.__MOCK_READY) {
    const handle = await globalThis.__MOCK_READY;
    if (url.startsWith('/chat')) await sleep(450); // cho thấy hiệu ứng "đang gõ"
    ({ status, data } = await handle(method, url, body, headers));
  } else {
    let res;
    try {
      res = await fetch(`${API_BASE}/api${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw Object.assign(new Error('Không kết nối được máy chủ. Kiểm tra mạng.'), { network: true });
    }
    status = res.status;
    data = await res.json().catch(() => ({}));
  }
  if (status === 401 && !url.startsWith('/auth/login')) window.dispatchEvent(new Event('finora:unauthorized'));
  if (status >= 400) throw Object.assign(new Error(data?.error || `Lỗi ${status}`), { status });
  return data;
}
export const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b || {}),
  put: (u, b) => req('PUT', u, b || {}),
  del: (u) => req('DELETE', u),
};
export const qs = (o) =>
  '?' + Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

// ---------- Hàng chờ offline ----------
// Ghi thu/chi khi mất mạng: lưu tạm trên máy, có mạng lại thì tự gửi. Mỗi mục có client_ref nên gửi lại không bị trùng.
export const outbox = {
  list() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch { return []; } },
  save(items) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); } catch { /* bỏ qua */ }
    window.dispatchEvent(new Event('finora:outbox'));
  },
  add(item) { outbox.save([...outbox.list(), { id: rid(), at: new Date().toISOString(), ...item }]); },
  clear() { outbox.save([]); },
};

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Gửi ngay nếu có mạng, mất mạng thì xếp hàng chờ. Trả về { queued: true } khi đã xếp hàng. */
export async function sendOrQueue(method, url, body, label) {
  if (isOffline()) {
    outbox.add({ method, url, body, label });
    return { queued: true };
  }
  try {
    return await req(method, url, body);
  } catch (e) {
    if (e.network) {
      outbox.add({ method, url, body, label });
      return { queued: true };
    }
    throw e;
  }
}

let flushing = null;
/** Gửi lần lượt các mục trong hàng chờ. Trả về { sent, failed: [{label, error}] } */
export function flushOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    const result = { sent: 0, failed: [] };
    for (const item of outbox.list()) {
      if (isOffline()) break;
      try {
        await req(item.method, item.url, item.body);
        result.sent++;
      } catch (e) {
        if (e.network) break; // vẫn mất mạng: giữ lại, thử sau
        result.failed.push({ label: item.label, error: e.message }); // server từ chối: bỏ khỏi hàng chờ, báo người dùng
      }
      outbox.save(outbox.list().filter((x) => x.id !== item.id));
    }
    return result;
  })().finally(() => { flushing = null; });
  return flushing;
}
