// Đồng bộ dữ liệu giữa các thiết bị: hỏi server định kỳ + khi mở lại app, gửi hàng chờ offline
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, CLIENT_ID, flushOutbox, outbox } from '../api.js';
import { useCatalog, useToast } from './ui.jsx';

const POLL_MS = 10_000;
const SyncCtx = createContext(null);

export function SyncProvider({ children }) {
  const toast = useToast();
  const { reload } = useCatalog();
  const known = useRef(null);
  const [st, setSt] = useState(() => ({
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    pending: outbox.list().length,
    syncing: false,
    lastSync: null,
    error: null,
  }));

  const check = useCallback(async ({ manual } = {}) => {
    if (navigator.onLine === false) {
      setSt((s) => ({ ...s, online: false }));
      if (manual) toast('📴 Đang offline: thay đổi sẽ tự đồng bộ khi có mạng');
      return;
    }
    // đồng bộ ngầm định kỳ: không bật biểu tượng "đang đồng bộ" để thanh menu khỏi nháy/vẽ lại mỗi 10 giây
    setSt((s) => (manual ? { ...s, syncing: true, online: true } : s.online ? s : { ...s, online: true }));
    try {
      const sent = await flushOutbox();
      if (sent.sent) toast(`☁️ Đã đồng bộ ${sent.sent} khoản ghi lúc offline`);
      sent.failed.forEach((f) => toast(`Không đồng bộ được "${f.label || 'giao dịch'}": ${f.error}`, 'error'));
      const s = await api.get('/sync');
      const changedElsewhere = known.current !== null && s.version !== known.current && s.client !== CLIENT_ID;
      if (changedElsewhere || sent.sent) {
        reload();
        window.dispatchEvent(new Event('finora:data-changed'));
      }
      if (changedElsewhere) toast('🔄 Đã cập nhật thay đổi từ thiết bị khác');
      known.current = s.version;
      setSt((x) => ({ ...x, syncing: false, lastSync: new Date(), error: null, pending: outbox.list().length }));
      if (manual && !changedElsewhere && !sent.sent) toast('✅ Dữ liệu đã đồng bộ');
    } catch (e) {
      setSt((x) => ({ ...x, syncing: false, error: e.message }));
    }
  }, [reload, toast]);

  useEffect(() => {
    check();
    const tick = () => document.visibilityState === 'visible' && check();
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && check();
    const onOnline = () => { setSt((s) => ({ ...s, online: true })); check(); };
    const onOffline = () => setSt((s) => ({ ...s, online: false }));
    const onOutbox = () => setSt((s) => ({ ...s, pending: outbox.list().length }));
    // Chính thiết bị này vừa ghi dữ liệu: cập nhật phiên bản đã biết để không báo nhầm là "thiết bị khác"
    const onLocalChange = () => setTimeout(() => api.get('/sync').then((s) => { if (s.client === CLIENT_ID) known.current = s.version; }).catch(() => {}), 300);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('finora:outbox', onOutbox);
    window.addEventListener('finora:data-changed', onLocalChange);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('finora:outbox', onOutbox);
      window.removeEventListener('finora:data-changed', onLocalChange);
    };
  }, [check]);

  return <SyncCtx.Provider value={{ ...st, syncNow: () => check({ manual: true }) }}>{children}</SyncCtx.Provider>;
}
export const useSync = () => useContext(SyncCtx);

export function timeAgo(d) {
  if (!d) return 'chưa';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 45) return 'vừa xong';
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  return `${Math.round(s / 86400)} ngày trước`;
}

/** Biểu tượng trạng thái đồng bộ trên thanh menu */
export function SyncBadge() {
  const s = useSync();
  if (!s) return null;
  const [icon, label, cls] = !s.online
    ? ['📴', s.pending ? `Offline · ${s.pending} chờ gửi` : 'Đang offline', 'off']
    : s.pending
      ? ['⏳', `${s.pending} khoản chờ đồng bộ`, 'wait']
      : s.syncing
        ? ['🔄', 'Đang đồng bộ…', 'spin']
        : s.error
          ? ['⚠️', 'Chưa đồng bộ được', 'off']
          : ['☁️', `Đã đồng bộ ${timeAgo(s.lastSync)}`, 'ok'];
  return (
    <button className={`sync-badge ${cls}`} onClick={s.syncNow} title={`${label} · bấm để đồng bộ ngay`} aria-label={label}>
      <span className="emo">{icon}</span>
      {s.pending > 0 && <span className="sync-count">{s.pending}</span>}
    </button>
  );
}
