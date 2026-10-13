import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Hive from './pages/Hive.jsx';
import Wallets from './pages/Wallets.jsx';
import Categories from './pages/Categories.jsx';
import Transactions from './pages/Transactions.jsx';
import Savings from './pages/Savings.jsx';
import Jars from './pages/Jars.jsx';
import Chat from './pages/Chat.jsx';
import Account from './pages/Account.jsx';
import { Modal, ThemeControl, useConfirm } from './components/ui.jsx';
import { Avatar, useAuth } from './components/auth.jsx';
import TxForm from './components/TxForm.jsx';
import { SyncBadge } from './components/sync.jsx';
import mark from './assets/finora-mark.png';

// Toàn bộ menu nằm trên 1 thanh, theo thứ tự dùng: xem → ghi → kế hoạch → thiết lập
const NAV = [
  ['/', '🏠', 'Tổng quan'],
  ['/hive', '🐝', 'Tổ ong'],
  ['/transactions', '🧾', 'Giao dịch'],
  ['/chat', '💬', 'Chat AI'],
  ['/jars', '🍯', 'Hũ tiền'],
  ['/savings', '🌸', 'Mục tiêu'],
  null, // vạch ngăn
  ['/wallets', '👛', 'Ví tiền', 'minor'],
  ['/categories', '🏷️', 'Danh mục', 'minor'],
];

function ProtoPill() {
  const ask = useConfirm();
  if (!import.meta.env.VITE_MOCK) return null;
  return (
    <div className="proto-pill">
      <span>🧪 Bản xem thử · dữ liệu lưu trên trình duyệt</span>
      <button className="ghost" onClick={async () => (await ask('Xoá mọi tài khoản, dữ liệu đã tạo và khôi phục dữ liệu mẫu?', 'Đặt lại')) && globalThis.__MOCK_RESET?.()}>↺ Đặt lại</button>
    </div>
  );
}

/** Menu người dùng: tài khoản, giao diện, đăng xuất */
function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`avatar-btn ${open || loc.pathname === '/account' ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Tài khoản">
        <Avatar user={user} size={36} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="menu-user">
            <Avatar user={user} size={44} />
            <div style={{ minWidth: 0 }}>
              <b className="ellipsis">{user.name}</b>
              <div className="faint ellipsis">{user.email}</div>
            </div>
          </div>
          <NavLink to="/account" className="menu-item" role="menuitem"><span className="emo">👤</span>Tài khoản & bảo mật</NavLink>
          <div className="menu-title" style={{ marginTop: 6 }}>Giao diện</div>
          <ThemeControl />
          <button className="menu-item danger" role="menuitem" onClick={logout} style={{ marginTop: 6 }}><span className="emo">🚪</span>Đăng xuất</button>
          <div style={{ marginTop: 6 }}><ProtoPill /></div>
        </div>
      )}
    </div>
  );
}

/** Thanh điều hướng dưới cùng cho điện thoại: trong tầm ngón cái, nút ＋ ở giữa */
const MOBILE_MAIN = [['/', '🏠', 'Tổng quan'], ['/transactions', '🧾', 'Giao dịch'], null, ['/chat', '💬', 'Chat'], 'more'];
const MOBILE_MORE = [
  ['/hive', '🐝', 'Tổ ong'], ['/jars', '🍯', 'Hũ tiền'], ['/savings', '🌸', 'Mục tiêu'],
  ['/wallets', '👛', 'Ví tiền'], ['/categories', '🏷️', 'Danh mục'], ['/account', '👤', 'Tài khoản'],
];
function MobileNav({ onQuick }) {
  const [more, setMore] = useState(false);
  const loc = useLocation();
  useEffect(() => setMore(false), [loc.pathname]);
  const inMore = MOBILE_MORE.some(([to]) => loc.pathname === to);
  return (
    <>
      <nav className="mnav" aria-label="Điều hướng (điện thoại)">
        {MOBILE_MAIN.map((n, i) =>
          n === null ? (
            <button key="fab" className="mnav-fab" onClick={onQuick} aria-label="Ghi thu chi nhanh"><span>＋</span></button>
          ) : n === 'more' ? (
            <button key="more" className={`mnav-item ${inMore || more ? 'active' : ''}`} onClick={() => setMore(true)} aria-expanded={more}>
              <span className="emo">☰</span><small>Thêm</small>
            </button>
          ) : (
            <NavLink key={n[0]} to={n[0]} end={n[0] === '/'} className="mnav-item">
              <span className="emo">{n[1]}</span><small>{n[2]}</small>
            </NavLink>
          )
        )}
      </nav>
      {more && (
        <Modal title="Đi tới" onClose={() => setMore(false)}>
          <div className="more-grid">
            {MOBILE_MORE.map(([to, emo, label]) => (
              <NavLink key={to} to={to} className="more-tile"><span className="emo">{emo}</span>{label}</NavLink>
            ))}
          </div>
          <div className="faint" style={{ margin: '16px 0 6px' }}>Giao diện</div>
          <ThemeControl />
          <div style={{ marginTop: 12 }}><ProtoPill /></div>
        </Modal>
      )}
    </>
  );
}

export default function App() {
  const loc = useLocation();
  const [quick, setQuick] = useState(false);

  // Phím tắt N: ghi nhanh ở bất kỳ trang nào
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      setQuick(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="topnav">
        <div className="topnav-in">
          <Link to="/" className="brand" aria-label="Finora — Stay focus, be present">
            <img src={mark} alt="" />
            <span className="brand-text"><b>Finora</b><small>Stay focus, be present</small></span>
          </Link>
          <nav className="tabs" aria-label="Điều hướng chính">
            {NAV.map((n, i) =>
              n ? (
                <NavLink key={n[0]} to={n[0]} end={n[0] === '/'} className={`tab ${n[3] || ''}`} title={n[2]} aria-label={n[2]}>
                  <span className="emo" aria-hidden>{n[1]}</span><span className="tab-label">{n[2]}</span>
                </NavLink>
              ) : (
                <span key={`sep${i}`} className="tab-sep" aria-hidden />
              )
            )}
          </nav>
          <div className="top-actions">
            <SyncBadge />
            <button className="primary quick-btn" onClick={() => setQuick(true)} title="Ghi thu/chi nhanh (phím N)">
              <span className="emo">✍️</span><span className="quick-label">Ghi nhanh</span><kbd>N</kbd>
            </button>
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="main">
        <div className="page" key={loc.pathname}>
          <Routes location={loc}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/hive" element={<Hive />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/jars" element={<Jars />} />
            <Route path="/savings" element={<Savings />} />
            <Route path="/wallets" element={<Wallets />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      <MobileNav onQuick={() => setQuick(true)} />
      {quick && (
        <Modal title="✍️ Ghi thu / chi nhanh" onClose={() => setQuick(false)}>
          <TxForm onDone={() => setQuick(false)} />
        </Modal>
      )}
    </div>
  );
}
