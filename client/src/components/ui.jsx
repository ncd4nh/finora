import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
// Ghi lại vị trí chuột lần bấm gần nhất để hộp thoại mở ngay tại đó
let lastPointer = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
}
const GAP = 12; // khoảng cách tối thiểu tới mép màn hình
const modalStack = []; // hộp thoại đang mở, cái mở sau cùng ở cuối

export function Modal({ title, onClose, children, footer, width }) {
  const ref = useRef(null);
  // điểm neo cố định từ lúc mở; bấm phím (không dùng chuột) hoặc màn hình nhỏ → căn giữa như cũ
  const [anchor] = useState(() => {
    const recent = lastPointer && Date.now() - lastPointer.t < 1500;
    const sheet = window.matchMedia('(max-width: 760px)').matches;
    return recent && !sheet ? { x: lastPointer.x, y: lastPointer.y } : null;
  });
  const [pos, setPos] = useState(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const me = {};
    modalStack.push(me);
    const k = (e) => e.key === 'Escape' && modalStack[modalStack.length - 1] === me && closeRef.current();
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); modalStack.splice(modalStack.indexOf(me), 1); };
  }, []);

  // đặt hộp thoại quanh điểm bấm, kẹp trong khung nhìn; tính lại khi nội dung/cửa sổ đổi kích thước
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const el = ref.current;
    const place = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      const left = Math.max(GAP, Math.min(anchor.x - w / 2, vw - w - GAP));
      const top = Math.max(GAP, Math.min(anchor.y - 24, vh - h - GAP));
      setPos({ left, top, origin: `${anchor.x - left}px ${anchor.y - top}px` });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener('resize', place);
    return () => { ro.disconnect(); window.removeEventListener('resize', place); };
  }, [anchor]);

  const style = {};
  if (width) style.width = `min(${width}px, 100%)`;
  if (anchor) {
    Object.assign(style, { position: 'absolute', margin: 0, maxHeight: `calc(100vh - ${GAP * 2}px)` });
    if (pos) Object.assign(style, { left: pos.left, top: pos.top, transformOrigin: pos.origin });
    else style.visibility = 'hidden'; // đo kích thước trước khi hiện, tránh nháy
  }

  // portal ra <body>: tránh bị "kẹt" trong khối cha có transform/animation (fixed sẽ lệch theo trang)
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal" style={style} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// ---------- Chọn biểu tượng (emoji) cho hũ, khoản thu/chi ----------
const ICON_GROUPS = [
  ['Tiền & tiết kiệm', '💰 💵 💳 🏦 🪙 💎 📈 🐷 🫙 🍯 🎯 🛡️ 🧾 💼'],
  ['Ăn uống', '🍜 🍚 🍔 🍕 🥗 ☕ 🧋 🍺 🛒 🥦 🍎 🍰'],
  ['Đi lại', '🚗 🛵 🚕 🚌 ✈️ ⛽ 🅿️ 🚲 🚆 🧳'],
  ['Nhà & hoá đơn', '🏠 💡 💧 📶 📱 🔧 🧹 🛋️ 🧺 🔥'],
  ['Sức khoẻ & học tập', '💊 🏥 🏋️ 🧘 📚 🎓 ✏️ 💻'],
  ['Mua sắm & giải trí', '🛍️ 👕 👟 💄 🎮 🎬 🎵 ⚽ 🎉 🏖️'],
  ['Gia đình & khác', '👨‍👩‍👧 👶 🐶 🐱 🎁 ❤️ 🤝 🙏 🌱 📦 ✨ ⭐'],
].map(([label, s]) => [label, s.split(' ')]);

/** Nút hiện emoji đang chọn; bấm mở bảng emoji theo nhóm + ô nhập emoji tuỳ ý */
export function IconPicker({ value, onChange, placeholder = '🙂', label = 'Chọn biểu tượng' }) {
  const btn = useRef(null);
  const [pos, setPos] = useState(null);
  const [custom, setCustom] = useState('');
  const close = useCallback(() => { setPos(null); setCustom(''); }, []);
  useEffect(() => {
    if (!pos) return;
    // Esc chỉ đóng bảng emoji, không đóng luôn hộp thoại bên ngoài
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const out = (e) => { if (!e.target.closest?.('.icon-pop') && !btn.current?.contains(e.target)) close(); };
    window.addEventListener('keydown', k, true);
    document.addEventListener('pointerdown', out, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('keydown', k, true); document.removeEventListener('pointerdown', out, true); window.removeEventListener('resize', close); };
  }, [pos, close]);
  function toggle() {
    if (pos) return close();
    const b = btn.current.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 16);
    const left = Math.max(8, Math.min(b.left, window.innerWidth - w - 8));
    const below = window.innerHeight - b.bottom > 340 || b.top < 340;
    setPos({ left, width: w, ...(below ? { top: b.bottom + 6 } : { bottom: window.innerHeight - b.top + 6 }) });
  }
  const pick = (e) => { onChange(e); close(); };
  return (
    <>
      <button ref={btn} type="button" className="icon-pick" onClick={toggle} aria-label={label} aria-expanded={!!pos} title={label}>
        <span className={value ? '' : 'faint'}>{value || placeholder}</span>
      </button>
      {pos && createPortal(
        <div className="icon-pop" style={pos} role="dialog" aria-label={label}>
          {ICON_GROUPS.map(([g, list]) => (
            <div key={g}>
              <div className="icon-pop-title">{g}</div>
              <div className="icon-pop-grid">
                {list.map((e) => (
                  <button key={e} type="button" className={value === e ? 'on' : ''} onClick={() => pick(e)} aria-label={e}>{e}</button>
                ))}
              </div>
            </div>
          ))}
          <form className="row icon-pop-custom" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) pick(custom.trim()); }}>
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Hoặc dán emoji khác…" maxLength={16} aria-label="Emoji tuỳ chọn" />
            <button type="submit" className="sm" disabled={!custom.trim()}>Dùng</button>
          </form>
        </div>,
        document.body
      )}
    </>
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
export function MoneyInput({ value, onChange, placeholder = 'VD: 100k, 1.5tr', autoFocus, currency, showHint = true }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => {
    if (value === '' || value == null) setText('');
    // giá trị được đặt từ bên ngoài (VD tải xong số tiền gợi ý) -> hiện lên ô nhập; đang gõ thì giữ nguyên chữ người dùng
    else if (parseMoneyLocal(String(value)) !== parseMoneyLocal(text)) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {showHint && text && <div className="faint" style={{ marginTop: 4 }}>= {fmt(parseMoneyLocal(text), currency)}</div>}
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

// ---------- Nút xoá dữ liệu mẫu (chỉ hiện khi tài khoản tạo kèm dữ liệu mẫu) ----------
export function ClearDemoButton({ className = 'sm' }) {
  const { settings, reload } = useCatalog();
  const ask = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!settings.has_demo) return null;
  async function clear() {
    if (!(await ask('Xoá toàn bộ giao dịch, mục tiêu tiết kiệm và kỳ chia hũ mẫu? Dữ liệu bạn tự nhập vẫn được giữ nguyên.', 'Xoá dữ liệu mẫu'))) return;
    setBusy(true);
    try {
      const r = await api.del('/demo-data');
      toast(`🧹 Đã xoá dữ liệu mẫu (${r.transactions} giao dịch)`);
      await reload();
      window.dispatchEvent(new Event('finora:data-changed'));
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  return <button type="button" className={`${className} danger`} onClick={clear} disabled={busy}>{busy ? 'Đang xoá…' : '🧹 Xoá dữ liệu mẫu'}</button>;
}
