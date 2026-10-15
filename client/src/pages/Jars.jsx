import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { dmy, fmt, parseMoney } from '../format.js';
import { Alert, CountUp, Modal, MoneyInput, Progress, StatusBadge, useCatalog, useConfirm, useLoad, useToast } from '../components/ui.jsx';

export default function Jars() {
  const [periods, reloadPeriods] = useLoad(() => api.get('/jar-periods'));
  const [sel, setSel] = useState('current');
  const [st, reload] = useLoad(() => api.get(sel === 'current' ? '/jar-periods/current' : `/jar-periods/${sel}`), [sel]);
  const [showConfig, setShowConfig] = useState(false);
  const refresh = () => { reload(); reloadPeriods(); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1><span className="emo">🍯</span>Hũ tiền</h1>
          <div className="faint">Chia lương theo % vào các hũ mỗi kỳ (từ ngày lương), theo dõi tốc độ chi của từng hũ.</div>
        </div>
        <div className="row">
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ width: 210 }} aria-label="Chọn kỳ">
            <option value="current">Kỳ hiện tại</option>
            {periods?.map((p) => <option key={p.id} value={p.id}>{dmy(p.start_date)} → {dmy(p.end_date)}</option>)}
          </select>
          <button onClick={() => setShowConfig(true)}>⚙️ Cấu hình hũ</button>
        </div>
      </div>
      {st && (st.period ? <PeriodView st={st} onChanged={refresh} /> : <SetupPeriod info={st} onDone={refresh} />)}
      {showConfig && <ConfigModal onClose={() => setShowConfig(false)} onSaved={refresh} />}
    </>
  );
}

function SetupPeriod({ info, onDone }) {
  const toast = useToast();
  const { jars } = useCatalog();
  const [income, setIncome] = useState(info.suggested.income_amount ? String(info.suggested.income_amount) : '');
  const [start, setStart] = useState(info.suggested.start_date);
  const amt = parseMoney(income);
  async function create() {
    try {
      await api.post('/jar-periods', { start_date: start, income_amount: amt });
      toast('Đã chia lương vào các hũ');
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  return (
    <div className="card">
      <h2>Chia lương kỳ {dmy(info.suggested.start_date)} → {dmy(info.suggested.end_date)}</h2>
      <p className="muted">Kỳ này chưa được chia hũ. Nhập số tiền lương/thu nhập cần chia (đã gợi ý theo các khoản thu đã ghi trong kỳ).</p>
      <div className="form-grid" style={{ maxWidth: 560 }}>
        <label className="field">Số tiền chia<MoneyInput value={income} onChange={setIncome} autoFocus /></label>
        <label className="field">Ngày bắt đầu kỳ<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      </div>
      <table className="table mt" style={{ maxWidth: 560 }}>
        <tbody>
          {jars.map((j) => (
            <tr key={j.id}>
              <td><span className="dot" style={{ background: j.color, marginRight: 8 }} />{j.icon} {j.name}</td>
              <td className="r">{j.percent}%</td>
              <td className="r num"><b>{fmt((amt * j.percent) / 100)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row mt">
        <button className="primary" disabled={!(amt > 0)} onClick={create}>Chia vào hũ</button>
        <Link to="/chat" className="faint">hoặc hỏi Chat AI cách chia phù hợp →</Link>
      </div>
    </div>
  );
}

function PeriodView({ st, onChanged }) {
  const toast = useToast();
  const ask = useConfirm();
  const [transfer, setTransfer] = useState(null);
  const [editAlloc, setEditAlloc] = useState(false);
  const p = st.period;

  async function removePeriod() {
    if (!(await ask('Xoá kỳ chia hũ này? (giao dịch không bị xoá)'))) return;
    await api.del(`/jar-periods/${p.id}`);
    toast('Đã xoá kỳ');
    onChanged();
  }

  return (
    <>
      <div className="grid g3 stagger stat-cards">
        <div className="card">
          <div className="stat-label"><span className="emo-chip" aria-hidden>🗓️</span>Kỳ lương</div>
          <div className="stat-value" style={{ fontSize: 19 }}>{dmy(p.start_date)} → {dmy(p.end_date)}</div>
          <div style={{ marginTop: 10 }}><Progress value={st.time_percent} max={100} color="var(--text-3)" thin label="Tiến độ thời gian" /></div>
          <div className="faint" style={{ marginTop: 6 }}>Ngày {st.elapsed_days}/{st.total_days} của kỳ · còn {st.days_left} ngày (tính cả hôm nay)</div>
        </div>
        <div className="card">
          <div className="stat-label"><span className="emo-chip" aria-hidden>💵</span>Tiền đã chia</div>
          <div className="stat-value"><CountUp value={st.income} /></div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="sm" onClick={() => setEditAlloc(true)}>Sửa phân bổ</button>
            <button className="sm ghost danger" onClick={removePeriod}>Xoá kỳ</button>
          </div>
        </div>
        <div className="card">
          <div className="stat-label"><span className="emo-chip" aria-hidden>🧮</span>Đã chi / còn lại</div>
          <div className="stat-value"><CountUp value={st.total_spent} /></div>
          <div className="faint num" style={{ marginTop: 6 }}>Còn {fmt(st.total_budget - st.total_spent)} · {st.total_budget ? Math.round((st.total_spent / st.total_budget) * 100) : 0}% ngân sách</div>
        </div>
      </div>

      {st.alerts.length > 0 && (
        <div className="grid mt" style={{ gap: 8 }}>
          {st.alerts.map((a, i) => (
            <Alert key={i} level={a.level}>
              {a.message}
              {a.suggestion?.amount > 0 && (
                <div style={{ marginTop: 6 }}>
                  <button className="sm" onClick={() => setTransfer({ from_jar_id: a.suggestion.from_jar_id, to_jar_id: a.jar_id, amount: String(a.suggestion.amount) })}>
                    Chuyển {fmt(a.suggestion.amount)} từ {a.suggestion.from_jar_name}
                  </button>
                </div>
              )}
            </Alert>
          ))}
        </div>
      )}

      <div className="grid g3 mt stagger">
        {st.jars.map((j) => (
          <div className="card lift" key={j.jar_id} style={{ borderTop: `3px solid ${j.color}` }}>
            <div className="row between">
              <b>{j.icon} {j.name}</b>
              {j.is_saving ? <span className="badge">Tích luỹ</span> : <StatusBadge status={j.status} />}
            </div>
            <div className="row between" style={{ margin: '12px 0 6px' }}>
              <span className="num"><b style={{ fontSize: 18 }}>{fmt(j.spent)}</b> <span className="faint">/ {fmt(j.budget)}</span></span>
              <span className="faint">{j.percent}%</span>
            </div>
            <Progress value={j.spent} max={j.budget} color={j.color} marker={j.is_saving ? null : st.time_percent} label={j.name} />
            <div className="kv">
              <div><div className="faint">Còn lại</div><b className={`num ${j.remaining < 0 ? 'neg' : ''}`}>{fmt(j.remaining)}</b></div>
              {!j.is_saving && <div><div className="faint">Được chi / ngày</div><b className="num">{fmt(j.daily_allowance)}</b></div>}
              {(j.transfer_in > 0 || j.transfer_out > 0) && (
                <div style={{ gridColumn: '1 / -1' }} className="faint">
                  {j.transfer_in > 0 && `+${fmt(j.transfer_in)} nhận `}{j.transfer_out > 0 && `−${fmt(j.transfer_out)} chuyển đi`}
                </div>
              )}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="sm" onClick={() => setTransfer({ from_jar_id: '', to_jar_id: j.jar_id, amount: '' })}>Bổ sung</button>
              <Link to={`/transactions`} className="faint" style={{ fontSize: 13 }}>Giao dịch</Link>
            </div>
          </div>
        ))}
      </div>
      {st.unassigned_spent > 0 && <div className="faint mt">Chi tiêu chưa gắn hũ: {fmt(st.unassigned_spent)} — vào <Link to="/categories">Danh mục</Link> để gắn hũ.</div>}

      {st.transfers.length > 0 && (
        <div className="card mt">
          <h3>Lịch sử chuyển hũ</h3>
          <table className="table">
            <tbody>
              {st.transfers.map((t) => (
                <tr key={t.id}>
                  <td>{st.jars.find((j) => j.jar_id === t.from_jar_id)?.name} → {st.jars.find((j) => j.jar_id === t.to_jar_id)?.name}</td>
                  <td className="faint">{t.note}</td>
                  <td className="r num">{fmt(t.amount)}</td>
                  <td className="r"><button className="ghost sm danger" onClick={async () => { await api.del(`/jar-transfers/${t.id}`); onChanged(); }}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {transfer && <TransferModal init={transfer} st={st} onClose={() => setTransfer(null)} onSaved={onChanged} />}
      {editAlloc && <AllocModal st={st} onClose={() => setEditAlloc(false)} onSaved={onChanged} />}
    </>
  );
}

function TransferModal({ init, st, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(init);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  async function save() {
    try {
      await api.post(`/jar-periods/${st.period.id}/transfer`, { ...f, amount: parseMoney(f.amount) });
      toast('Đã chuyển tiền giữa hũ');
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  return (
    <Modal title="Chuyển tiền giữa các hũ" onClose={onClose} footer={<><button onClick={onClose}>Huỷ</button><button className="primary" onClick={save}>Chuyển</button></>}>
      <div className="form-grid">
        <label className="field">Từ hũ
          <select value={f.from_jar_id} onChange={(e) => set('from_jar_id', e.target.value)}>
            <option value="">— Chọn —</option>
            {st.jars.map((j) => <option key={j.jar_id} value={j.jar_id}>{j.icon} {j.name} (còn {fmt(j.remaining)})</option>)}
          </select>
        </label>
        <label className="field">Sang hũ
          <select value={f.to_jar_id} onChange={(e) => set('to_jar_id', e.target.value)}>
            {st.jars.map((j) => <option key={j.jar_id} value={j.jar_id}>{j.icon} {j.name}</option>)}
          </select>
        </label>
        <label className="field">Số tiền<MoneyInput value={f.amount} onChange={(v) => set('amount', v)} autoFocus /></label>
        <label className="field">Ghi chú<input value={f.note || ''} onChange={(e) => set('note', e.target.value)} /></label>
      </div>
    </Modal>
  );
}

function AllocModal({ st, onClose, onSaved }) {
  const toast = useToast();
  const [income, setIncome] = useState(String(st.income));
  const [pct, setPct] = useState(() => Object.fromEntries(st.jars.map((j) => [j.jar_id, j.percent])));
  const amt = parseMoney(income);
  const total = Object.values(pct).reduce((s, v) => s + Number(v || 0), 0);
  async function save() {
    try {
      await api.put(`/jar-periods/${st.period.id}`, { income_amount: amt, allocations: st.jars.map((j) => ({ jar_id: j.jar_id, percent: Number(pct[j.jar_id] || 0) })) });
      toast('Đã cập nhật phân bổ');
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  return (
    <Modal title="Sửa phân bổ kỳ này" onClose={onClose} footer={<><span className={total !== 100 ? 'neg' : 'faint'} style={{ marginRight: 'auto' }}>Tổng: {Math.round(total * 100) / 100}%</span><button onClick={onClose}>Huỷ</button><button className="primary" onClick={save}>Lưu</button></>}>
      <label className="field">Số tiền chia<MoneyInput value={income} onChange={setIncome} /></label>
      <table className="table mt">
        <tbody>
          {st.jars.map((j) => (
            <tr key={j.jar_id}>
              <td>{j.icon} {j.name}</td>
              <td style={{ width: 100 }}><input inputMode="decimal" value={pct[j.jar_id]} onChange={(e) => setPct((s) => ({ ...s, [j.jar_id]: e.target.value }))} aria-label={`% ${j.name}`} /></td>
              <td className="r num" style={{ width: 130 }}>{fmt((amt * Number(pct[j.jar_id] || 0)) / 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function ConfigModal({ onClose, onSaved }) {
  const { jars, reload } = useCatalog();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [salaryDay, setSalaryDay] = useState(10);
  useEffect(() => {
    setList(jars.map((j) => ({ ...j })));
    api.get('/settings').then((s) => setSalaryDay(s.salary_day));
  }, [jars]);
  const upd = (i, k, v) => setList((l) => l.map((j, x) => (x === i ? { ...j, [k]: v } : j)));
  const total = list.reduce((s, j) => s + Number(j.percent || 0), 0);
  async function save() {
    try {
      await api.put('/jars', list.map((j) => ({ ...j, percent: Number(j.percent) || 0, is_saving: j.is_saving ? 1 : 0 })));
      await api.put('/settings', { salary_day: salaryDay });
      toast('Đã lưu cấu hình hũ');
      reload();
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  return (
    <Modal title="Cấu hình hũ tiền" onClose={onClose} width={720}
      footer={<><span className={Math.abs(total - 100) > 0.01 ? 'neg' : 'faint'} style={{ marginRight: 'auto' }}>Tổng: {Math.round(total * 100) / 100}% (phải = 100%)</span><button onClick={onClose}>Huỷ</button><button className="primary" onClick={save}>Lưu</button></>}>
      <label className="field" style={{ maxWidth: 220, marginBottom: 12 }}>Ngày nhận lương hằng tháng
        <input type="number" min={1} max={31} value={salaryDay} onChange={(e) => setSalaryDay(e.target.value)} />
      </label>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Màu</th><th>Icon</th><th>Tên hũ</th><th>%</th><th title="Hũ tích luỹ không bị cảnh báo tốc độ chi">Tích luỹ</th></tr></thead>
          <tbody>
            {list.map((j, i) => (
              <tr key={j.id || i}>
                <td style={{ width: 52 }}><input type="color" value={j.color || '#888888'} onChange={(e) => upd(i, 'color', e.target.value)} style={{ padding: 2, height: 34 }} /></td>
                <td style={{ width: 64 }}><input value={j.icon || ''} onChange={(e) => upd(i, 'icon', e.target.value)} /></td>
                <td><input value={j.name} onChange={(e) => upd(i, 'name', e.target.value)} /></td>
                <td style={{ width: 80 }}><input inputMode="decimal" value={j.percent} onChange={(e) => upd(i, 'percent', e.target.value)} /></td>
                <td style={{ width: 70, textAlign: 'center' }}><input type="checkbox" checked={!!j.is_saving} onChange={(e) => upd(i, 'is_saving', e.target.checked)} style={{ width: 'auto' }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="sm mt" onClick={() => setList((l) => [...l, { name: 'Hũ mới', percent: 0, color: '#4a3aa7', icon: '🫙', is_saving: 0 }])}>+ Thêm hũ</button>
      <p className="faint">Thay đổi % áp dụng cho các kỳ chia mới. Kỳ hiện tại sửa ở nút "Sửa phân bổ".</p>
    </Modal>
  );
}
