// Đăng nhập: trạng thái người dùng, ảnh đại diện, ô mật khẩu
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, tokenStore } from '../api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, ready: false });
  const signOutLocal = useCallback(() => { tokenStore.set(null); setState({ user: null, ready: true }); }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!tokenStore.get()) return setState({ user: null, ready: true });
      try {
        const u = await api.get('/auth/me');
        if (alive) setState({ user: u, ready: true });
      } catch {
        if (alive) signOutLocal();
      }
    })();
    window.addEventListener('finora:unauthorized', signOutLocal);
    return () => { alive = false; window.removeEventListener('finora:unauthorized', signOutLocal); };
  }, [signOutLocal]);

  const value = {
    ...state,
    signIn: ({ token, user }) => { tokenStore.set(token); setState({ user, ready: true }); },
    setUser: (user) => setState((s) => ({ ...s, user })),
    logout: async () => { try { await api.post('/auth/logout'); } catch { /* bỏ qua */ } signOutLocal(); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

/** Ảnh đại diện: ảnh tải lên / emoji / chữ cái đầu */
export function Avatar({ user, size = 36 }) {
  const a = user?.avatar;
  const style = { width: size, height: size, fontSize: size * 0.5 };
  if (a && a.startsWith('data:image')) return <img className="avatar" src={a} alt="" style={style} />;
  if (a) return <span className="avatar emoji" style={{ ...style, fontSize: size * 0.58 }} aria-hidden>{a}</span>;
  const initials = (user?.name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
  return <span className="avatar initials" style={style} aria-hidden>{initials}</span>;
}

/** Độ mạnh mật khẩu 0..4 */
export function passwordScore(pw = '') {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
const LEVEL = [
  ['Rất yếu', 'var(--bad)'],
  ['Yếu', 'var(--bad)'],
  ['Tạm được', 'var(--warn)'],
  ['Mạnh', 'var(--good)'],
  ['Rất mạnh 💪', 'var(--good)'],
];

export function PasswordField({ id, label, value, onChange, autoComplete = 'current-password', meter, autoFocus }) {
  const [show, setShow] = useState(false);
  const score = passwordScore(value);
  return (
    <label className="field" htmlFor={id}>
      {label}
      <div className="pw-wrap">
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} required />
        <button type="button" className="pw-eye ghost" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{show ? '🙈' : '👁️'}</button>
      </div>
      {meter && value && (
        <div className="pw-meter" aria-live="polite">
          <div className="pw-bars">{[0, 1, 2, 3].map((i) => <i key={i} style={{ background: i < score ? LEVEL[score][1] : undefined }} />)}</div>
          <span style={{ color: LEVEL[score][1] }}>{LEVEL[score][0]}</span>
          <span className="faint"> · tối thiểu 8 ký tự, có chữ và số</span>
        </div>
      )}
    </label>
  );
}

/** Thu nhỏ ảnh thành hình vuông 256px (JPEG) để làm ảnh đại diện */
export function imageToAvatar(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Hãy chọn một file ảnh'));
    if (file.size > 8 * 1024 * 1024) return reject(new Error('Ảnh tối đa 8MB'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được ảnh'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Ảnh không hợp lệ'));
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const s = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Hộp thư mô phỏng (chỉ có trong bản prototype) */
export function useMockOutbox() {
  return globalThis.__MOCK_OUTBOX || null;
}
