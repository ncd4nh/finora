// Cài đặt người dùng: hồ sơ, ảnh đại diện, đổi mật khẩu, quên mật khẩu, giao diện, đăng xuất
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Avatar, PasswordField, imageToAvatar, useAuth } from '../components/auth.jsx';
import { ThemeControl, useConfirm, useToast } from '../components/ui.jsx';
import { MockInbox } from './Auth.jsx';
import { timeAgo, useSync } from '../components/sync.jsx';
import { outbox } from '../api.js';

const EMOJIS = ['🐝', '🌻', '🌸', '🍯', '🦋', '🐞', '🌿', '🍀', '🐣', '🦊', '🐼', '🐨', '🦁', '🐸', '🌵', '⭐'];

export default function Account() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const ask = useConfirm();
  const fileRef = useRef(null);
  const [profile, setProfile] = useState({ name: user.name, email: user.email });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState('');
  const [mailSent, setMailSent] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);

  async function saveAvatar(avatar) {
    setBusy('avatar');
    try {
      setUser(await api.put('/auth/me', { avatar }));
      toast(avatar ? 'Đã cập nhật ảnh đại diện' : 'Đã xoá ảnh đại diện');
      setShowEmoji(false);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }
  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { await saveAvatar(await imageToAvatar(file)); } catch (err) { toast(err.message, 'error'); }
  }
  async function saveProfile(e) {
    e.preventDefault();
    setBusy('profile');
    try { setUser(await api.put('/auth/me', profile)); toast('Đã lưu hồ sơ'); } catch (err) { toast(err.message, 'error'); } finally { setBusy(''); }
  }
  async function changePw(e) {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast('Mật khẩu nhập lại không khớp', 'error');
    setBusy('pw');
    try {
      await api.post('/auth/me/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast('Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(''); }
  }
  async function sendReset() {
    setBusy('mail');
    try { await api.post('/auth/forgot', { email: user.email }); setMailSent(true); toast(`Đã gửi email tới ${user.email}`); } catch (err) { toast(err.message, 'error'); } finally { setBusy(''); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1><span className="emo">👤</span>Tài khoản</h1>
          <div className="sub">Hồ sơ, ảnh đại diện và bảo mật đăng nhập.</div>
        </div>
      </div>

      <div className="grid g-main">
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="card-head"><h2><span className="emo">🪪</span>Hồ sơ</h2></div>
            <div className="profile-top">
              <div className="avatar-edit">
                <Avatar user={user} size={96} />
                {busy === 'avatar' && <span className="avatar-busy">…</span>}
              </div>
              <div className="grid" style={{ gap: 8, alignContent: 'start' }}>
                <b style={{ fontSize: 18 }}>{user.name}</b>
                <span className="faint">{user.email}</span>
                <div className="row wrap" style={{ marginTop: 4 }}>
                  <button type="button" className="sm" onClick={() => fileRef.current?.click()}>📷 Tải ảnh lên</button>
                  <button type="button" className="sm" onClick={() => setShowEmoji((s) => !s)} aria-expanded={showEmoji}>🐝 Chọn biểu tượng</button>
                  {user.avatar && <button type="button" className="sm ghost danger" onClick={() => saveAvatar(null)}>Xoá ảnh</button>}
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
              </div>
            </div>
            {showEmoji && (
              <div className="emoji-grid" role="listbox" aria-label="Chọn biểu tượng làm ảnh đại diện">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" className={user.avatar === e ? 'on' : ''} onClick={() => saveAvatar(e)} aria-label={`Biểu tượng ${e}`}>{e}</button>
                ))}
              </div>
            )}
            <form onSubmit={saveProfile} className="form-grid" style={{ marginTop: 16 }}>
              <label className="field" htmlFor="acc-name">Tên hiển thị
                <input id="acc-name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required />
              </label>
              <label className="field" htmlFor="acc-email">Email đăng nhập
                <input id="acc-email" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} required />
              </label>
              <div className="full row" style={{ justifyContent: 'flex-end' }}>
                <button className="primary" disabled={busy === 'profile'}>Lưu hồ sơ</button>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="card-head"><h2><span className="emo">🔒</span>Đổi mật khẩu</h2></div>
            <form onSubmit={changePw} className="grid" style={{ gap: 12 }}>
              <PasswordField id="pw-cur" label="Mật khẩu hiện tại" value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} />
              <div className="form-grid">
                <PasswordField id="pw-new" label="Mật khẩu mới" value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} autoComplete="new-password" meter />
                <PasswordField id="pw-new2" label="Nhập lại mật khẩu mới" value={pw.confirm} onChange={(v) => setPw({ ...pw, confirm: v })} autoComplete="new-password" />
              </div>
              <div className="row between wrap">
                <span className="faint">Đổi xong, các thiết bị khác sẽ bị đăng xuất.</span>
                <button className="primary" disabled={busy === 'pw'}>Đổi mật khẩu</button>
              </div>
            </form>
          </div>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="card-head"><h2><span className="emo">📧</span>Quên mật khẩu?</h2></div>
            <p className="muted" style={{ marginTop: 0 }}>Gửi liên kết đặt lại mật khẩu tới <b>{user.email}</b>. Liên kết có hiệu lực 30 phút.</p>
            <button onClick={sendReset} disabled={busy === 'mail'}>✉️ Gửi email đặt lại mật khẩu</button>
            {mailSent && <div style={{ marginTop: 12 }}><MockInbox email={user.email} /></div>}
          </div>
          <SyncCard />
          <DevicesCard />
          <div className="card">
            <div className="card-head"><h2><span className="emo">🎨</span>Giao diện</h2></div>
            <ThemeControl />
          </div>
          <div className="card">
            <div className="card-head"><h2><span className="emo">🚪</span>Phiên đăng nhập</h2></div>
            <p className="muted" style={{ marginTop: 0 }}>Tham gia từ {String(user.created_at || '').slice(0, 10).split('-').reverse().join('/')}.</p>
            <button className="danger" onClick={async () => (await ask('Đăng xuất khỏi Finora?', 'Đăng xuất')) && logout()}>Đăng xuất</button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Trạng thái đồng bộ của thiết bị này */
function SyncCard() {
  const s = useSync();
  const ask = useConfirm();
  if (!s) return null;
  const pending = outbox.list();
  return (
    <div className="card">
      <div className="card-head"><h2><span className="emo">☁️</span>Đồng bộ</h2><span className={`badge ${s.online ? 'good' : 'warn'}`}>{s.online ? 'Trực tuyến' : 'Offline'}</span></div>
      <p className="muted" style={{ marginTop: 0 }}>
        Dữ liệu lưu trên máy chủ theo tài khoản: đăng nhập trên điện thoại hay máy tính đều thấy giống nhau.
        Thay đổi từ thiết bị khác tự cập nhật sau vài giây, hoặc ngay khi bạn mở lại app.
      </p>
      <div className="row between wrap">
        <span className="faint">Lần đồng bộ gần nhất: <b>{timeAgo(s.lastSync)}</b>{pending.length ? ` · ${pending.length} khoản chờ gửi` : ''}</span>
        <button onClick={s.syncNow} disabled={s.syncing}>{s.syncing ? '🔄 Đang đồng bộ…' : '🔄 Đồng bộ ngay'}</button>
      </div>
      {pending.length > 0 && (
        <div className="pending-list">
          {pending.map((p) => <div key={p.id} className="faint">⏳ {p.label || p.url} · {new Date(p.at).toLocaleString('vi-VN')}</div>)}
          <button className="ghost sm danger" onClick={async () => (await ask('Bỏ các khoản đang chờ đồng bộ? Chúng sẽ không được lưu.', 'Bỏ')) && outbox.clear()}>Bỏ hàng chờ</button>
        </div>
      )}
    </div>
  );
}

/** Các thiết bị đang đăng nhập tài khoản */
function DevicesCard() {
  const toast = useToast();
  const ask = useConfirm();
  const [list, setList] = useState(null);
  const load = () => api.get('/auth/sessions').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const icon = (d = '') => (/iPhone|Android/.test(d) ? '📱' : /iPad/.test(d) ? '📲' : '💻');
  async function revoke(s) {
    if (!(await ask(`Đăng xuất "${s.device}"?`, 'Đăng xuất'))) return;
    try { await api.del(`/auth/sessions/${s.id}`); toast('Đã đăng xuất thiết bị'); load(); } catch (e) { toast(e.message, 'error'); }
  }
  async function revokeOthers() {
    if (!(await ask('Đăng xuất tất cả thiết bị khác?', 'Đăng xuất'))) return;
    const r = await api.post('/auth/sessions/logout-others');
    toast(`Đã đăng xuất ${r.count} thiết bị`);
    load();
  }
  return (
    <div className="card">
      <div className="card-head"><h2><span className="emo">📱</span>Thiết bị đang đăng nhập</h2></div>
      {!list && <div className="faint">Đang tải…</div>}
      {list?.map((s) => (
        <div key={s.id} className="device-row">
          <span className="device-ico" aria-hidden>{icon(s.device)}</span>
          <div className="grow">
            <b>{s.device || 'Thiết bị không rõ'}</b> {s.current && <span className="badge good">Thiết bị này</span>}
            <div className="faint">Hoạt động {timeAgo(s.last_seen || s.created_at)} · đăng nhập {new Date(String(s.created_at).replace(' ', 'T')).toLocaleDateString('vi-VN')}</div>
          </div>
          {!s.current && <button className="sm ghost danger" onClick={() => revoke(s)}>Đăng xuất</button>}
        </div>
      ))}
      {list?.length > 1 && <button className="sm" style={{ marginTop: 10 }} onClick={revokeOthers}>Đăng xuất mọi thiết bị khác</button>}
    </div>
  );
}
