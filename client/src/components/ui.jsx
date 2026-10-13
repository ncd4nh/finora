import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { fmt, parseMoney as parseMoneyLocal } from '../format.js';

// ---------- Toast ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [list, setList] = useState([]);
  const push = useCallback((text, type = 'info') => {
    const id = Math.random();
    setList((l) => [...l, { id, text, type }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), type === 'error' ? 5000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Dữ liệu danh mục dùng chung (ví, khoản thu chi, hũ) ----------
const CatalogCtx = createContext(null);
export function CatalogProvider({ children }) {
  const [data, setData] = useState({ wallets: [], categories: [], jars: [], settings: {} });
  const reload = useCallback(async () => {
    try {
      const [wallets, categories, jars, settings] = await Promise.all([
        api.get('/wallets'), api.get('/categories'), api.get('/jars'), api.get('/settings'),
      ]);
      setData({ wallets, categories, jars, settings });
    } catch {
      /* mất mạng: giữ dữ liệu đang có, lần đồng bộ sau sẽ tải lại */
    }
  }, []);
  useEffect(() => { reload().catch(() => {}); }, [reload]);
  return <CatalogCtx.Provider value={{ ...data, reload }}>{children}</CatalogCtx.Provider>;
}
export const useCatalog = () => useContext(CatalogCtx);

/** Hook tải dữ liệu: const [data, reload, loading, error] = useLoad(() => api.get('/x'), [deps]) */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await fn(), loading: false, error: null });
    } catch (e) {
      // mất mạng khi đã có dữ liệu: giữ dữ liệu cũ thay vì báo lỗi cả trang
      setState((s) => ({ data: s.data, loading: false, error: s.data ? null : e.message }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  // tải lại khi có dữ liệu mới (VD: ghi nhanh từ thanh menu)
  useEffect(() => {
    window.addEventListener('finora:data-changed', load);
    return () => window.removeEventListener('finora:data-changed', load);
  }, [load]);
  return [state.data, load, state.loading, state.error];
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, footer, width }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Thanh tiến độ (có vạch mốc thời gian) ----------
export function Progress({ value, max, color = 'var(--accent)', marker, thin, label }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : value > 0 ? 100 : 0;
  return (
    <div className={`bar ${thin ? 'thin' : ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="fill" style={{ width: `${pct}%`, background: color }} />
      {marker != null && <div className="marker" style={{ left: `calc(${Math.min(100, marker)}% - 1px)` }} title={`Mốc thời gian: ${Math.round(marker)}%`} />}
    </div>
  );
}

export const STATUS = {
  ok: { cls: 'good', label: 'Ổn', icon: '✓' },
  warning: { cls: 'warn', label: 'Chi nhanh', icon: '⚠' },
  danger: { cls: 'bad', label: 'Nguy cơ vượt', icon: '⚠' },
  over: { cls: 'bad', label: 'Vượt ngân sách', icon: '✕' },
};
export function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.ok;
  return <span className={`badge ${s.cls} ${status === 'over' ? 'pulse' : ''}`}>{s.icon} {s.label}</span>;
}

export const HEALTH = {
  on_track: { cls: 'good', label: 'Đúng tiến độ' },
  ahead: { cls: 'good', label: 'Vượt tiến độ' },
  behind: { cls: 'warn', label: 'Chậm tiến độ' },
  overdue: { cls: 'bad', label: 'Quá hạn' },
  done: { cls: 'good', label: 'Hoàn thành' },
};

export function Alert({ level = 'info', children }) {
  const icon = { warning: '⚠️', danger: '🚨', info: 'ℹ️' }[level];
  return (
    <div className={`alert ${level}`}>
      <span className="a-ico" aria-hidden>{icon}</span>
      <div className="grow">{children}</div>
    </div>
  );
}

export function Money({ v, cur, sign, className = '' }) {
  const cls = sign ? (v > 0 ? 'pos' : v < 0 ? 'neg' : '') : '';
  return <span className={`num ${cls} ${className}`}>{sign && v > 0 ? '+' : ''}{fmt(v, cur)}</span>;
}

/** Ô nhập tiền: cho phép gõ 100k, 1.5tr ; hiển thị số đã hiểu */
export function MoneyInput({ value, onChange, placeholder = 'VD: 100k, 1.5tr', autoFocus, currency }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => {
    if (value === '' || value == null) setText('');
  }, [value]);
  return (
    <div>
      <input
        inputMode="decimal"
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
      />
      {text && <div className="faint" style={{ marginTop: 4 }}>= {fmt(parseMoneyLocal(text), currency)}</div>}
    </div>
  );
}

// ---------- Số chạy (count-up) ----------
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export function CountUp({ value, format = fmt, duration = 900, className = '' }) {
  const [shown, setShown] = useState(reduceMotion() ? value : 0);
  const fromRef = useRef(reduceMotion() ? value : 0);
  useEffect(() => {
    if (reduceMotion()) { setShown(value); return; }
    const from = fromRef.current;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      const cur = from + (value - from) * e;
      setShown(cur);
      fromRef.current = cur;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={`num ${className}`}>{format(shown)}</span>;
}

// ---------- Giao diện: bảng màu + sáng/tối ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* bỏ qua */ } },
};
const HOST_THEME = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
const ThemeCtx = createContext(null);
export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => store.get('fin-mode') || 'auto');
  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'auto') HOST_THEME ? root.setAttribute('data-theme', HOST_THEME) : root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    store.set('fin-mode', mode);
  }, [mode]);
  return <ThemeCtx.Provider value={{ mode, setMode }}>{children}</ThemeCtx.Provider>;
}
export const useTheme = () => useContext(ThemeCtx);

/** Chọn giao diện Sáng / Tối / Tự động */
export function ThemeControl() {
  const { mode, setMode } = useTheme();
  return (
    <div className="seg" role="group" aria-label="Giao diện">
      {[['auto', 'Tự động'], ['light', 'Sáng'], ['dark', 'Tối']].map(([k, l]) => (
        <button key={k} className={mode === k ? 'on' : ''} aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>
      ))}
    </div>
  );
}

// ---------- Hộp xác nhận trong trang (thay cho window.confirm) ----------
const ConfirmCtx = createContext(async () => false);
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const ask = useCallback((message, okLabel = 'Xoá') => new Promise((resolve) => setState({ message, okLabel, resolve })), []);
  const close = (v) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <Modal title="Xác nhận" onClose={() => close(false)} width={420}
          footer={<><button onClick={() => close(false)}>Huỷ</button><button className="primary" autoFocus onClick={() => close(true)}>{state.okLabel}</button></>}>
          <p style={{ margin: 0 }}>{state.message}</p>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);
