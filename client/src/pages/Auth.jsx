// Màn hình tài khoản: đăng nhập, đăng ký, quên mật khẩu, đặt lại mật khẩu
import { useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { PasswordField, useAuth, useMockOutbox } from '../components/auth.jsx';
import { ThemeControl } from '../components/ui.jsx';
import { Bee } from '../components/icons.jsx';
import { Honeycomb } from '../components/hive.jsx';
import logo from '../assets/finora-logo.png';
import mark from '../assets/finora-mark.png';

const DEMO = { email: 'demo@finora.vn', password: 'finora123' };

function Shell({ title, sub, children }) {
  return (
    <div className="auth">
      <aside className="auth-art" aria-hidden>
        <img src={logo} alt="" className="auth-logo" />
        <div className="auth-slogan">Stay focus, be present.</div>
        <p className="auth-tag">Ong chăm chỉ gom mật mỗi ngày.<br />Bạn chăm chỉ ghi chép, tổ ong tài chính sẽ đầy.</p>
        <div className="auth-hive">
          <Honeycomb percent={62} size={150} />
          <Bee size={70} className="auth-bee" />
        </div>
        <ul className="auth-points">
          <li>🍯 Chia lương vào hũ, cảnh báo khi chi quá nhanh</li>
          <li>🌸 Mục tiêu tiết kiệm nở hoa theo tiến độ</li>
          <li>💬 Ghi thu chi bằng một câu chat</li>
        </ul>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-brand-sm"><img src={mark} alt="" /><span className="brand-text"><b>Finora</b><small>Stay focus, be present</small></span></div>
          <h1>{title}</h1>
          {sub && <p className="muted" style={{ marginTop: 6 }}>{sub}</p>}
          {children}
        </div>
        <div className="auth-theme"><ThemeControl /></div>
      </main>
    </div>
  );
}

function ErrorBox({ error }) {
  return error ? <div className="alert danger" role="alert" style={{ marginTop: 14 }}><span className="a-ico">⚠️</span><div>{error}</div></div> : null;
}

function Login() {
  const { signIn } = useAuth();
  const [f, setF] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isProto = !!import.meta.env.VITE_MOCK;
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { signIn(await api.post('/auth/login', f)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <Shell title="Chào mừng trở lại 👋" sub="Đăng nhập để tiếp tục gom mật cùng Finora.">
      {isProto && (
        <div className="demo-hint">
          <span>🐝 Tài khoản dùng thử: <b>{DEMO.email}</b> / <b>{DEMO.password}</b></span>
          <button type="button" className="sm" onClick={() => setF(DEMO)}>Điền sẵn</button>
        </div>
      )}
      <form onSubmit={submit} className="auth-form">
        <label className="field" htmlFor="login-email">Email
          <input id="login-email" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoFocus />
        </label>
        <PasswordField id="login-pw" label="Mật khẩu" value={f.password} onChange={(v) => setF({ ...f, password: v })} />
        <div className="row between"><span /><Link to="/forgot-password" className="faint">Quên mật khẩu?</Link></div>
        <ErrorBox error={error} />
        <button className="primary block" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
      </form>
      <p className="auth-switch">Chưa có tài khoản? <Link to="/register">Tạo tài khoản mới</Link></p>
    </Shell>
  );
}

function Register() {
  const { signIn } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', demo: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (f.password !== f.confirm) return setError('Mật khẩu nhập lại không khớp');
    setBusy(true); setError(null);
    try { signIn(await api.post('/auth/register', f)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <Shell title="Tạo tài khoản 🌱" sub="Mỗi tài khoản có dữ liệu riêng: ví, hũ, mục tiêu.">
      <form onSubmit={submit} className="auth-form">
        <label className="field" htmlFor="reg-name">Tên hiển thị
          <input id="reg-name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus placeholder="VD: Hải" />
        </label>
        <label className="field" htmlFor="reg-email">Email
          <input id="reg-email" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required placeholder="ban@email.com" />
        </label>
        <PasswordField id="reg-pw" label="Mật khẩu" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" meter />
        <PasswordField id="reg-pw2" label="Nhập lại mật khẩu" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} autoComplete="new-password" />
        <label className="check" htmlFor="reg-demo">
          <input id="reg-demo" type="checkbox" checked={f.demo} onChange={(e) => setF({ ...f, demo: e.target.checked })} />
          Thêm dữ liệu mẫu ~3 tháng để xem thử
        </label>
        <ErrorBox error={error} />
        <button className="primary block" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo tài khoản'}</button>
      </form>
      <p className="auth-switch">Đã có tài khoản? <Link to="/login">Đăng nhập</Link></p>
    </Shell>
  );
}

/** Bản prototype không gửi email thật: hiện email vừa "gửi" để thử tiếp luồng */
export function MockInbox({ email }) {
  const outbox = useMockOutbox();
  const navigate = useNavigate();
  if (!outbox) return null;
  const mail = [...outbox].reverse().find((m) => !email || m.to === email.trim().toLowerCase());
  if (!mail) return <p className="faint">📭 Hộp thư mô phỏng chưa có email (email này chưa có tài khoản).</p>;
  return (
    <div className="mock-mail">
      <div className="mock-mail-head">📬 Hộp thư mô phỏng · <b>{mail.to}</b></div>
      <div className="mock-mail-subj">{mail.subject}</div>
      <pre className="mock-mail-body">{mail.text.replace(/https?:\S+|#\/\S+/g, '[liên kết]')}</pre>
      <button className="primary sm" onClick={() => navigate(`/reset-password?token=${encodeURIComponent(mail.token)}`)}>Mở liên kết đặt lại mật khẩu</button>
    </div>
  );
}

function Forgot() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { setDone((await api.post('/auth/forgot', { email })).message); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <Shell title="Quên mật khẩu 🔑" sub="Nhập email đã đăng ký, chúng tôi sẽ gửi liên kết đặt lại mật khẩu.">
      {done ? (
        <>
          <div className="alert info" style={{ marginTop: 16 }}><span className="a-ico">📧</span><div>{done}</div></div>
          <div style={{ marginTop: 14 }}><MockInbox email={email} /></div>
        </>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <label className="field" htmlFor="fg-email">Email
            <input id="fg-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <ErrorBox error={error} />
          <button className="primary block" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi email đặt lại'}</button>
        </form>
      )}
      <p className="auth-switch"><Link to="/login">← Quay lại đăng nhập</Link></p>
    </Shell>
  );
}

function Reset() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [f, setF] = useState({ password: '', confirm: '' });
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(token ? null : 'Liên kết thiếu mã đặt lại. Hãy mở lại liên kết trong email.');
  async function submit(e) {
    e.preventDefault();
    if (f.password !== f.confirm) return setError('Mật khẩu nhập lại không khớp');
    setBusy(true); setError(null);
    try { setDone((await api.post('/auth/reset', { token, password: f.password })).message); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <Shell title="Đặt mật khẩu mới 🔒" sub="Mật khẩu mới sẽ đăng xuất mọi thiết bị đang đăng nhập.">
      {done ? (
        <>
          <div className="alert info" style={{ marginTop: 16 }}><span className="a-ico">✅</span><div>{done}</div></div>
          <Link to="/login"><button className="primary block" style={{ marginTop: 14 }}>Đăng nhập</button></Link>
        </>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <PasswordField id="rs-pw" label="Mật khẩu mới" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" meter autoFocus />
          <PasswordField id="rs-pw2" label="Nhập lại mật khẩu mới" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} autoComplete="new-password" />
          <ErrorBox error={error} />
          <button className="primary block" disabled={busy || !token}>{busy ? 'Đang lưu…' : 'Lưu mật khẩu mới'}</button>
        </form>
      )}
      <p className="auth-switch"><Link to="/login">← Quay lại đăng nhập</Link></p>
    </Shell>
  );
}

export default function AuthScreens() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<Forgot />} />
      <Route path="/reset-password" element={<Reset />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
