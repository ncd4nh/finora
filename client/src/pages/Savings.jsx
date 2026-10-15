import { useState } from 'react';
import { api } from '../api.js';
import { dmy, fmt, parseMoney, todayISO } from '../format.js';
import { HEALTH, Modal, MoneyInput, Progress, useCatalog, useConfirm, useLoad, useToast } from '../components/ui.jsx';

const addMonths = (iso, n) => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};

export default function Savings() {
  const [goals, reload] = useLoad(() => api.get('/savings'));
  const [edit, setEdit] = useState(null);
  const [contrib, setContrib] = useState(null);
  const [detail, setDetail] = useState(null);
  const active = goals?.filter((g) => g.status === 'active') || [];
  const done = goals?.filter((g) => g.status !== 'active') || [];
  const monthlyTotal = active.reduce((s, g) => s + g.required_monthly, 0);

  const section = (title, list) =>
    list.length > 0 && (
      <>
        <h2 style={{ margin: '18px 0 10px' }}>{title}</h2>
        <div className="grid g3 stagger">{list.map((g) => <GoalCard key={g.id} g={g} onContribute={() => setContrib(g)} onEdit={() => setEdit(g)} onDetail={() => setDetail(g)} />)}</div>
      </>
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1><span className="emo">🌸</span>Mục tiêu tiết kiệm</h1>
          <div className="faint">Tổng cần để dành mỗi tháng cho các mục tiêu đang chạy: <b className="num">{fmt(monthlyTotal)}</b></div>
        </div>
        <button className="primary" onClick={() => setEdit({})}>+ Mục tiêu mới</button>
      </div>
      {section('🎯 Ngắn hạn (≤ 1 năm)', active.filter((g) => g.kind === 'short'))}
      {section('🏔️ Dài hạn', active.filter((g) => g.kind === 'long'))}
      {section('✅ Đã xong / huỷ', done)}
      {goals && !goals.length && <div className="card empty">Chưa có mục tiêu. VD: "6 tháng tiết kiệm 12tr để mua laptop".</div>}

      {edit && <GoalModal g={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      {contrib && <ContribModal g={contrib} onClose={() => setContrib(null)} onSaved={reload} />}
      {detail && <DetailModal id={detail.id} onClose={() => setDetail(null)} onChanged={reload} />}
    </>
  );
}

function GoalCard({ g, onContribute, onEdit, onDetail }) {
  const h = HEALTH[g.health] || HEALTH.on_track;
  return (
    <div className="card lift">
      <div className="row between">
        <b style={{ cursor: 'pointer' }} onClick={onDetail}>{g.icon || '🎯'} {g.name}</b>
        <span className={`badge ${h.cls}`}>{h.label}</span>
      </div>
      {g.purpose && <div className="faint" style={{ marginTop: 2 }}>{g.purpose}</div>}
      <div className="row between" style={{ margin: '12px 0 6px' }}>
        <span className="num"><b style={{ fontSize: 18 }}>{fmt(g.saved)}</b> <span className="faint">/ {fmt(g.target_amount)}</span></span>
        <b>{g.percent}%</b>
      </div>
      <Progress value={g.saved} max={g.target_amount} color="var(--income)" marker={g.time_percent} label={g.name} />
      <div className="kv">
        <div><div className="faint">Cần mỗi tháng</div><b className="num">{fmt(g.required_monthly)}</b></div>
        <div><div className="faint">Còn lại</div><b>{g.months_left} tháng</b> <span className="faint">· {dmy(g.target_date)}</span></div>
        <div><div className="faint">Kế hoạch ban đầu</div><span className="num">{fmt(g.planned_monthly)}/tháng</span></div>
        <div><div className="faint">Lẽ ra đã có</div><span className="num">{fmt(g.expected_now)}</span></div>
      </div>
      {g.status === 'active' && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="sm primary" onClick={onContribute}>+ Nạp tiền</button>
          <button className="sm" onClick={onDetail}>Lịch sử</button>
          <button className="sm ghost" onClick={onEdit}>Sửa</button>
        </div>
      )}
    </div>
  );
}

function GoalModal({ g, onClose, onSaved }) {
  const { wallets, jars } = useCatalog();
  const toast = useToast();
  const ask = useConfirm();
  const [f, setF] = useState({
    name: g.name || '', purpose: g.purpose || '', target_amount: g.target_amount || '', icon: g.icon || '',
    start_date: g.start_date || todayISO(), target_date: g.target_date || addMonths(todayISO(), 6),
    wallet_id: g.wallet_id || '', jar_id: g.jar_id || (jars.find((j) => j.code === 'LTSS')?.id ?? ''), initial_saved: '', status: g.status || 'active',
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const target = parseMoney(f.target_amount);
  const days = (new Date(f.target_date) - new Date(f.start_date)) / 86400000;
  const months = Math.max(1, Math.ceil(days / 30.4375));
  const monthly = Math.max(0, target - (g.saved ?? parseMoney(f.initial_saved))) / months;

  async function save() {
    try {
      const body = { ...f, target_amount: target, initial_saved: parseMoney(f.initial_saved), wallet_id: f.wallet_id || null, jar_id: f.jar_id || null };
      if (g.id) await api.put(`/savings/${g.id}`, body);
      else await api.post('/savings', body);
      toast('Đã lưu mục tiêu');
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function remove() {
    if (!(await ask('Xoá mục tiêu?'))) return;
    await api.del(`/savings/${g.id}`);
    onSaved();
    onClose();
  }
  return (
    <Modal
      title={g.id ? 'Sửa mục tiêu' : 'Mục tiêu tiết kiệm mới'}
      onClose={onClose}
      footer={<>{g.id && <button className="danger" onClick={remove} style={{ marginRight: 'auto' }}>Xoá</button>}<button onClick={onClose}>Huỷ</button><button className="primary" onClick={save}>Lưu</button></>}
    >
      <div className="form-grid">
        <label className="field">Tên mục tiêu<input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="VD: Laptop mới" autoFocus /></label>
        <label className="field">Biểu tượng<input value={f.icon} onChange={(e) => set('icon', e.target.value)} placeholder="💻" /></label>
        <label className="field full">Để làm gì<input value={f.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="VD: mua dụng cụ vẽ" /></label>
        <label className="field">Số tiền cần<MoneyInput value={f.target_amount} onChange={(v) => set('target_amount', v)} /></label>
        {!g.id ? (
          <label className="field">Đã có sẵn<MoneyInput value={f.initial_saved} onChange={(v) => set('initial_saved', v)} placeholder="0" /></label>
        ) : (
          <label className="field">Trạng thái
            <select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="active">Đang chạy</option><option value="done">Hoàn thành</option><option value="cancelled">Huỷ</option></select>
          </label>
        )}
        <label className="field">Bắt đầu<input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></label>
        <label className="field">Hạn hoàn thành
          <input type="date" value={f.target_date} onChange={(e) => set('target_date', e.target.value)} />
          <div className="chips" style={{ marginTop: 4 }}>
            {[3, 6, 12, 24, 60].map((m) => <button type="button" key={m} className="chip" onClick={() => set('target_date', addMonths(f.start_date, m))}>{m < 12 ? `${m} tháng` : `${m / 12} năm`}</button>)}
          </div>
        </label>
        <label className="field">Ví giữ tiền (tuỳ chọn)
          <select value={f.wallet_id} onChange={(e) => set('wallet_id', e.target.value)}>
            <option value="">— Không tách ví —</option>{wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="field">Lấy từ hũ
          <select value={f.jar_id} onChange={(e) => set('jar_id', e.target.value)}>
            <option value="">—</option>{jars.map((j) => <option key={j.id} value={j.id}>{j.icon} {j.name}</option>)}
          </select>
        </label>
      </div>
      {target > 0 && (
        <div className="alert info" style={{ marginTop: 14 }}>
          <span className="a-ico">💡</span>
          <div>Trong <b>{months} tháng</b> cần tiết kiệm <b className="num">{fmt(Math.ceil(monthly / 1000) * 1000)}/tháng</b> (≈ {fmt(Math.ceil(monthly / 30.4 / 1000) * 1000)}/ngày) để đạt {fmt(target)}.</div>
        </div>
      )}
    </Modal>
  );
}

function ContribModal({ g, onClose, onSaved }) {
  const { wallets, reload } = useCatalog();
  const toast = useToast();
  const [f, setF] = useState({ amount: g.required_monthly ? String(g.required_monthly) : '', from_wallet_id: '', date: todayISO(), note: '', withdraw: false });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  async function save() {
    try {
      const amt = parseMoney(f.amount);
      const r = await api.post(`/savings/${g.id}/contribute`, { ...f, amount: f.withdraw ? -amt : amt, from_wallet_id: f.from_wallet_id || null });
      toast(r.goal.status === 'done' ? '🎉 Chúc mừng! Đã hoàn thành mục tiêu' : `Đã ${f.withdraw ? 'rút' : 'nạp'} ${fmt(amt)}`);
      reload();
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  return (
    <Modal title={`${f.withdraw ? 'Rút' : 'Nạp'} tiền · ${g.name}`} onClose={onClose} footer={<><button onClick={onClose}>Huỷ</button><button className="primary" onClick={save}>Xác nhận</button></>}>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={!f.withdraw ? 'on inc' : ''} onClick={() => set('withdraw', false)}>Nạp vào</button>
        <button className={f.withdraw ? 'on exp' : ''} onClick={() => set('withdraw', true)}>Rút ra</button>
      </div>
      <div className="form-grid">
        <label className="field">Số tiền<MoneyInput value={f.amount} onChange={(v) => set('amount', v)} autoFocus /></label>
        <label className="field">Ngày<input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
        <label className="field full">{f.withdraw ? 'Rút về ví' : 'Lấy từ ví'} {g.wallet_id ? '(sẽ ghi giao dịch chuyển ví)' : '(chỉ đánh dấu, không trừ ví)'}
          <select value={f.from_wallet_id} onChange={(e) => set('from_wallet_id', e.target.value)}>
            <option value="">— Không chọn —</option>{wallets.filter((w) => w.id !== g.wallet_id).map((w) => <option key={w.id} value={w.id}>{w.name} ({fmt(w.balance, w.currency)})</option>)}
          </select>
        </label>
        <label className="field full">Ghi chú<input value={f.note} onChange={(e) => set('note', e.target.value)} /></label>
      </div>
    </Modal>
  );
}

function DetailModal({ id, onClose, onChanged }) {
  const ask = useConfirm();
  const [g, reload] = useLoad(() => api.get(`/savings/${id}`), [id]);
  async function remove(c) {
    if (!(await ask('Xoá lần nạp này?'))) return;
    await api.del(`/savings/contributions/${c.id}`);
    reload();
    onChanged();
  }
  return (
    <Modal title={g ? `${g.icon || '🎯'} ${g.name}` : 'Đang tải'} onClose={onClose} width={620}>
      {g && (
        <>
          <Progress value={g.saved} max={g.target_amount} color="var(--income)" marker={g.time_percent} />
          <div className="row between faint" style={{ margin: '6px 0 14px' }}><span>{fmt(g.saved)} / {fmt(g.target_amount)}</span><span>Cần {fmt(g.required_monthly)}/tháng · còn {g.months_left} tháng</span></div>
          <table className="table">
            <thead><tr><th>Ngày</th><th>Ví</th><th>Ghi chú</th><th className="r">Số tiền</th><th /></tr></thead>
            <tbody>
              {g.contributions.map((c) => (
                <tr key={c.id}>
                  <td>{dmy(c.date)}</td><td>{c.wallet_name || '—'}</td><td className="faint">{c.note}</td>
                  <td className={`r num ${c.amount < 0 ? 'neg' : 'pos'}`}>{c.amount > 0 ? '+' : ''}{fmt(c.amount)}</td>
                  <td className="r"><button className="ghost sm danger" onClick={() => remove(c)}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!g.contributions.length && <div className="empty">Chưa nạp lần nào</div>}
        </>
      )}
    </Modal>
  );
}
