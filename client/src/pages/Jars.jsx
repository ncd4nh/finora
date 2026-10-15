import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { dmy, fmt, parseMoney } from '../format.js';
import { Alert, CountUp, IconPicker, Modal, MoneyInput, Progress, StatusBadge, useCatalog, useConfirm, useLoad, useToast } from '../components/ui.jsx';

const r2 = (v) => Math.round(v * 100) / 100;
/** Chia tiền như server: hũ cố định nhận đủ trước, phần còn lại chia theo % */
function splitIncome(income, rows) {
  const fixedTotal = rows.reduce((s, r) => s + (r.fixed > 0 ? r.fixed : 0), 0);
  const rest = Math.max(0, income - fixedTotal);
  const pctRows = rows.filter((r) => !(r.fixed > 0));
  const pctTotal = pctRows.reduce((s, r) => s + (Number(r.percent) || 0), 0);
  const amounts = Object.fromEntries(rows.map((r) => [r.id, r.fixed > 0 ? r.fixed : (rest * (Number(r.percent) || 0)) / 100]));
  // không bắt buộc chia đủ 100%: phần còn lại để ngoài các hũ
  const unallocated = Math.max(0, income - Object.values(amounts).reduce((a, b) => a + b, 0));
  return { fixedTotal, rest, pctTotal, hasPct: pctRows.length > 0, amounts, unallocated };
}
/** Lỗi chia hũ (nếu có): tổng % không vượt 100, tổng cố định không vượt số tiền chia */
function splitError(sp, income) {
  if (income > 0 && sp.fixedTotal > income) return `Tổng các hũ cố định (${fmt(sp.fixedTotal)}) lớn hơn số tiền chia (${fmt(income)})`;
  if (sp.pctTotal > 100.01) return `Tổng % các hũ chia theo tỷ lệ không được vượt 100% (hiện ${r2(sp.pctTotal)}%)`;
  return null;
}

/** Xem trước số tiền từng hũ nhận theo cấu hình hiện tại */
function previewSplit(jars, amt) {
  const sp = splitIncome(amt, jars.map((j) => ({ id: j.id, fixed: j.fixed_amount, percent: j.percent })));
  return { sp, err: amt > 0 ? splitError(sp, amt) : null };
}
function SplitPreview({ jars, sp, err }) {
  return (
    <>
      <table className="table mt" style={{ maxWidth: 560 }}>
        <tbody>
          {jars.map((j) => (
            <tr key={j.id}>
              <td><span className="dot" style={{ background: j.color, marginRight: 8 }} />{j.icon} {j.name}</td>
              <td className="r faint">{j.fixed_amount > 0 ? 'Cố định' : `${j.percent}%`}</td>
              <td className="r num"><b>{fmt(sp.amounts[j.id])}</b></td>
            </tr>
          ))}
          {sp.unallocated > 0.5 && (
            <tr><td className="faint">Chưa chia vào hũ</td><td /><td className="r num faint">{fmt(sp.unallocated)}</td></tr>
          )}
        </tbody>
      </table>
      {sp.fixedTotal > 0 && <p className="faint" style={{ maxWidth: 560 }}>Các hũ cố định nhận đủ {fmt(sp.fixedTotal)} trước, phần còn lại {fmt(sp.rest)} chia cho các hũ theo %.</p>}
      {err && <p className="neg">{err}</p>}
    </>
  );
}

/** Chọn cách chia cho 1 hũ: % phần còn lại hoặc số tiền cố định */
function SplitInput({ name, mode, onMode, percent, onPercent, amount, onAmount, hint }) {
  return (
    <>
      <div className="seg" role="group" aria-label={`Cách chia hũ ${name}`}>
        <button type="button" className={mode === 'pct' ? 'on' : ''} onClick={() => onMode('pct')}>%</button>
        <button type="button" className={mode === 'amount' ? 'on' : ''} onClick={() => onMode('amount')}>Cố định</button>
      </div>
      <div className="jar-cfg-val">
        {mode === 'pct'
          ? <input inputMode="decimal" value={percent} onChange={(e) => onPercent(e.target.value)} aria-label={`% hũ ${name}`} placeholder="%" />
          : <MoneyInput value={amount} onChange={onAmount} />}
        {hint && <small>{hint}</small>}
      </div>
    </>
  );
}

export default function Jars() {
  const [periods, reloadPeriods] = useLoad(() => api.get('/jar-periods'));
  const [sel, setSel] = useState('current');
  const [st, reload] = useLoad(() => api.get(sel === 'current' ? '/jar-periods/current' : `/jar-periods/${sel}`), [sel]);
  const [showConfig, setShowConfig] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const refresh = () => { reload(); reloadPeriods(); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1><span className="emo">🍯</span>Hũ tiền</h1>
          <div className="faint">Chia lương vào các hũ mỗi kỳ (theo % hoặc số tiền cố định), theo dõi tốc độ chi của từng hũ.</div>
        </div>
        <div className="row jar-head-actions">
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ width: 210 }} aria-label="Chọn kỳ">
            <option value="current">Kỳ hiện tại</option>
            {periods?.map((p) => <option key={p.id} value={p.id}>{dmy(p.start_date)} → {dmy(p.end_date)}</option>)}
          </select>
          <button onClick={() => setShowConfig(true)}>⚙️ Cấu hình hũ</button>
          <button className="primary" onClick={() => setShowNew(true)}>＋ Chia hũ kỳ mới</button>
        </div>
      </div>
      {st && (st.period ? <PeriodView st={st} onChanged={refresh} /> : <SetupPeriod info={st} onDone={refresh} />)}
      {showConfig && <ConfigModal onClose={() => setShowConfig(false)} onSaved={refresh} />}
      {/* chuyển sang xem kỳ vừa chia; không gọi reload() của kỳ đang xem để tránh dữ liệu cũ về sau ghi đè */}
      {showNew && <NewPeriodModal onClose={() => setShowNew(false)} onDone={(id) => { if (String(id) === sel) refresh(); else { setSel(String(id)); reloadPeriods(); } }} />}
    </>
  );
}

function SetupPeriod({ info, onDone }) {
  const toast = useToast();
  const { jars } = useCatalog();
  const [income, setIncome] = useState(info.suggested.income_amount ? String(info.suggested.income_amount) : '');
  const [start, setStart] = useState(info.suggested.start_date);
  const amt = parseMoney(income);
  const { sp, err } = previewSplit(jars, amt);
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
      <p className="muted">Kỳ này chưa được chia hũ. Nhập số tiền cần chia (gợi ý theo "Số tiền chia mỗi kỳ" trong Cấu hình hũ, hoặc theo các khoản thu đã ghi trong kỳ).</p>
      <div className="form-grid" style={{ maxWidth: 560 }}>
        <label className="field">Số tiền chia<MoneyInput value={income} onChange={setIncome} autoFocus /></label>
        <label className="field">Ngày bắt đầu kỳ<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      </div>
      <SplitPreview jars={jars} sp={sp} err={err} />
      <div className="row mt">
        <button className="primary" disabled={!(amt > 0) || !!err} onClick={create}>Chia vào hũ</button>
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
          {st.unallocated > 0 && <div className="faint num">Chưa chia vào hũ: {fmt(st.unallocated)}</div>}
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
  const { jars } = useCatalog();
  const [income, setIncome] = useState(String(st.income));
  // hũ cấu hình cố định -> mở ở chế độ số tiền; hũ theo % -> quy ra % phần còn lại
  const [rows, setRows] = useState(() => {
    const fixedIds = new Set(jars.filter((j) => j.fixed_amount > 0).map((j) => j.id));
    const rest0 = st.income - st.jars.filter((j) => fixedIds.has(j.jar_id)).reduce((s, j) => s + j.allocated, 0);
    const list = st.jars.map((j) => ({
      id: j.jar_id, name: j.name, icon: j.icon,
      mode: fixedIds.has(j.jar_id) ? 'amount' : 'pct',
      amount: String(j.allocated),
      percent: rest0 > 0 ? r2((j.allocated / rest0) * 100) : 0,
      // tỷ lệ chính xác (chưa làm tròn): giữ nguyên số tiền khi không sửa hũ này
      exact: rest0 > 0 ? (j.allocated / rest0) * 100 : null,
    }));
    return list;
  });
  const upd = (i, k, v) => setRows((l) => l.map((r, x) => (x === i ? { ...r, [k]: v, ...(k === 'percent' || k === 'mode' ? { exact: null } : {}) } : r)));
  const amt = parseMoney(income);
  const sp = splitIncome(amt, rows.map((r) => ({ id: r.id, fixed: r.mode === 'amount' ? parseMoney(r.amount) || 0 : null, percent: r.exact ?? r.percent })));
  const err = splitError(sp, amt);
  async function save() {
    if (err) return toast(err, 'error');
    try {
      await api.put(`/jar-periods/${st.period.id}`, { income_amount: amt, allocations: rows.map((r) => ({ jar_id: r.id, amount: Math.round(sp.amounts[r.id]) })) });
      toast('Đã cập nhật phân bổ');
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  return (
    <Modal title="Sửa phân bổ kỳ này" onClose={onClose} width={620}
      footer={<><span className={err ? 'neg' : 'faint'} style={{ marginRight: 'auto', fontSize: 13 }}>{err || `Cố định ${fmt(sp.fixedTotal)} · theo % ${r2(sp.pctTotal)}% của ${fmt(sp.rest)}${sp.unallocated > 0.5 ? ` · chưa chia ${fmt(sp.unallocated)}` : ''}`}</span><button onClick={onClose}>Huỷ</button><button className="primary" onClick={save}>Lưu</button></>}>
      <label className="field">Số tiền chia<MoneyInput value={income} onChange={setIncome} /></label>
      <div className="jar-cfg mt">
        {rows.map((r, i) => (
          <div key={r.id} className="jar-cfg-row alloc">
            <span className="jar-cfg-name">{r.icon} {r.name}</span>
            <SplitInput name={r.name} mode={r.mode} onMode={(m) => upd(i, 'mode', m)} percent={r.percent} onPercent={(v) => upd(i, 'percent', v)}
              amount={r.amount} onAmount={(v) => upd(i, 'amount', v)}
              hint={r.mode === 'pct' ? `= ${fmt(sp.amounts[r.id])}` : amt > 0 ? `≈ ${r2((sp.amounts[r.id] / amt) * 100)}% thu nhập` : ''} />
          </div>
        ))}
      </div>
      <p className="faint">Hũ "Cố định" nhận đủ số tiền trước, phần còn lại chia cho các hũ theo % (tối đa 100%; phần thiếu để ngoài hũ).</p>
    </Modal>
  );
}

function ConfigModal({ onClose, onSaved }) {
  const { jars, categories, reload } = useCatalog();
  const toast = useToast();
  const ask = useConfirm();
  const [list, setList] = useState([]);
  const [salaryDay, setSalaryDay] = useState(10);
  const [splitAmount, setSplitAmount] = useState(''); // số tiền chia hũ mặc định mỗi kỳ
  const [curIncome, setCurIncome] = useState(0); // thu nhập kỳ hiện tại (dùng khi chưa nhập số tiền chia)
  const refIncome = parseMoney(splitAmount) || curIncome; // để quy đổi % <-> số tiền
  useEffect(() => {
    setList(jars.map((j) => ({ ...j, mode: j.fixed_amount > 0 ? 'amount' : 'pct', amount: j.fixed_amount > 0 ? String(j.fixed_amount) : '' })));
    api.get('/settings').then((s) => { setSalaryDay(s.salary_day); setSplitAmount(s.split_amount ? String(s.split_amount) : ''); });
    api.get('/jar-periods/current').then((st) => setCurIncome(st.period ? st.income : st.suggested?.income_amount || 0)).catch(() => {});
  }, [jars]);
  const upd = (i, k, v) => setList((l) => l.map((j, x) => (x === i ? { ...j, [k]: v } : j)));
  // hũ bị đánh dấu xoá (del) không tính vào tổng; id theo vị trí trong list để khớp với hint()
  const sp = splitIncome(refIncome, list.map((j, i) => ({ id: i, del: j.del, fixed: j.mode === 'amount' ? parseMoney(j.amount) || 0 : null, percent: j.percent })).filter((r) => !r.del));
  const pctErr = sp.pctTotal > 100.01;
  const removed = list.filter((j) => j.del);
  async function remove(i) {
    const j = list[i];
    if (!j.id) return setList((l) => l.filter((_, x) => x !== i)); // hũ mới chưa lưu: bỏ luôn
    const n = categories.filter((c) => c.jar_id === j.id).length;
    const ok = await ask(
      `Xoá hũ "${j.name}"? ${n ? `${n} khoản chi đang gắn hũ này sẽ thành "chưa gắn hũ" (gán lại ở Danh mục). ` : ''}` +
      'Kỳ hiện tại và các kỳ sau bỏ phần chia cho hũ này; các kỳ trước vẫn giữ để xem lại. Áp dụng khi bấm Lưu.',
      'Xoá hũ'
    );
    if (ok) upd(i, 'del', true);
  }
  async function save() {
    const missing = list.find((j) => !j.del && j.mode === 'amount' && !(parseMoney(j.amount) > 0));
    if (missing) return toast(`Nhập số tiền cố định cho hũ "${missing.name}"`, 'error');
    try {
      await api.put('/jars', list.map(({ mode, amount, del, ...j }) => ({
        ...j,
        archived: del ? 1 : 0,
        percent: mode === 'pct' ? Number(j.percent) || 0 : 0,
        fixed_amount: mode === 'amount' ? parseMoney(amount) : null,
        is_saving: j.is_saving ? 1 : 0,
      })));
      await api.put('/settings', { salary_day: salaryDay, split_amount: parseMoney(splitAmount) || '' });
      toast('Đã lưu cấu hình hũ');
      reload();
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  const hint = (j, i) => {
    if (!refIncome) return j.mode === 'pct' ? 'của phần còn lại' : '';
    return j.mode === 'pct' ? `≈ ${fmt(sp.amounts[i])}/kỳ` : `≈ ${r2((sp.amounts[i] / refIncome) * 100)}% thu nhập`;
  };
  return (
    <Modal title="Cấu hình hũ tiền" onClose={onClose} width={760}
      footer={<>
        <div className="jar-cfg-sum" style={{ marginRight: 'auto' }}>
          <span className={pctErr ? 'neg' : 'faint'}>Theo %: {r2(sp.pctTotal)}% (tối đa 100%)</span>
          {sp.fixedTotal > 0 && <span className={refIncome && sp.fixedTotal > refIncome ? 'neg' : 'faint'}>Cố định: {fmt(sp.fixedTotal)}</span>}
          {refIncome > 0 && sp.unallocated > 0.5 && <span className="faint">Chưa chia: {fmt(sp.unallocated)}</span>}
        </div>
        <button onClick={onClose}>Huỷ</button><button className="primary" onClick={save}>Lưu</button>
      </>}>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <label className="field">Ngày nhận lương hằng tháng
          <input type="number" min={1} max={31} value={salaryDay} onChange={(e) => setSalaryDay(e.target.value)} />
        </label>
        <label className="field">Số tiền chia hũ mỗi kỳ
          <MoneyInput value={splitAmount} onChange={setSplitAmount} />
          <small className="faint">Tự điền khi chia hũ kỳ mới. Để trống = gợi ý theo các khoản thu đã ghi.</small>
        </label>
      </div>
      <div className="jar-cfg">
        <div className="jar-cfg-row jar-cfg-head"><span>Màu</span><span>Icon</span><span>Tên hũ</span><span>Cách chia</span><span>Tỷ lệ / số tiền</span><span title="Hũ tích luỹ không bị cảnh báo tốc độ chi">Tích luỹ</span><span /></div>
        {list.map((j, i) => !j.del && (
          <div className="jar-cfg-row" key={j.id || `new-${i}`}>
            <input type="color" value={j.color || '#888888'} onChange={(e) => upd(i, 'color', e.target.value)} aria-label={`Màu hũ ${j.name}`} />
            <IconPicker value={j.icon} onChange={(v) => upd(i, 'icon', v)} placeholder="🫙" label={`Biểu tượng hũ ${j.name}`} />
            <input value={j.name} onChange={(e) => upd(i, 'name', e.target.value)} aria-label="Tên hũ" />
            <SplitInput name={j.name} mode={j.mode} onMode={(m) => upd(i, 'mode', m)} percent={j.percent} onPercent={(v) => upd(i, 'percent', v)}
              amount={j.amount} onAmount={(v) => upd(i, 'amount', v)} hint={hint(j, i)} />
            <label className="check jar-cfg-save" title="Hũ tích luỹ không bị cảnh báo tốc độ chi">
              <input type="checkbox" checked={!!j.is_saving} onChange={(e) => upd(i, 'is_saving', e.target.checked)} />
              <span className="only-m">Hũ tích luỹ</span>
            </label>
            <button type="button" className="ghost sm danger jar-cfg-del" onClick={() => remove(i)} aria-label={`Xoá hũ ${j.name}`} title="Xoá hũ">🗑</button>
          </div>
        ))}
      </div>
      {removed.length > 0 && (
        <div className="row wrap faint" style={{ gap: 8, marginTop: 10, fontSize: 13 }}>
          Sẽ xoá khi lưu: {removed.map((j) => (
            <span key={j.id} className="badge">{j.icon} {j.name}
              <button type="button" className="ghost sm" style={{ padding: '0 4px', minHeight: 0 }} onClick={() => setList((l) => l.map((x) => (x === j ? { ...x, del: false } : x)))} aria-label={`Hoàn tác xoá ${j.name}`}>↶</button>
            </span>
          ))}
        </div>
      )}
      <button className="sm mt" onClick={() => setList((l) => [...l, { name: 'Hũ mới', percent: 0, mode: 'pct', amount: '', color: '#4a3aa7', icon: '🫙', is_saving: 0 }])}>+ Thêm hũ</button>
      <p className="faint">
        Hũ <b>Cố định</b> nhận đủ số tiền mỗi kỳ (kể cả khi thu nhập thay đổi); phần còn lại chia cho các hũ theo <b>%</b> (tối đa 100%, không cần đủ — phần thiếu để ngoài hũ).
        {refIncome > 0 && <> Số tiền ước tính theo {parseMoney(splitAmount) ? 'số tiền chia mỗi kỳ' : 'thu nhập kỳ hiện tại'} {fmt(refIncome)}.</>} Thay đổi áp dụng cho các kỳ chia mới; kỳ hiện tại sửa ở nút "Sửa phân bổ".
      </p>
    </Modal>
  );
}

/** Chia hũ cho kỳ mới: mặc định kỳ ngay sau kỳ đã chia gần nhất, số tiền theo cấu hình */
function NewPeriodModal({ onClose, onDone }) {
  const toast = useToast();
  const { jars } = useCatalog();
  const [pv, setPv] = useState(null);
  const [start, setStart] = useState('');
  const [income, setIncome] = useState('');
  const [busy, setBusy] = useState(false);
  const load = (s) => api.get('/jar-periods/preview' + (s ? `?start=${s}` : '')).then((r) => {
    setPv(r);
    setStart(r.start_date);
    setIncome((v) => v || (r.income_amount ? String(r.income_amount) : ''));
  }).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const amt = parseMoney(income);
  const { sp, err } = previewSplit(jars, amt);
  async function create() {
    setBusy(true);
    try {
      const st = await api.post('/jar-periods', { start_date: start, income_amount: amt });
      toast(`Đã chia hũ kỳ ${dmy(st.period.start_date)} → ${dmy(st.period.end_date)}`);
      onDone(st.period.id);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Chia hũ kỳ mới" onClose={onClose} width={600}
      footer={<><button onClick={onClose}>Huỷ</button><button className="primary" disabled={busy || !pv || !(amt > 0) || !!err} onClick={create}>{pv?.existing_id ? 'Chia lại' : 'Chia vào hũ'}</button></>}>
      <div className="form-grid">
        <label className="field">Số tiền chia<MoneyInput value={income} onChange={setIncome} autoFocus /></label>
        <label className="field">Ngày bắt đầu kỳ
          <input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) load(e.target.value); }} />
          {pv && <small className="faint">Kỳ {dmy(pv.start_date)} → {dmy(pv.end_date)}</small>}
        </label>
      </div>
      {pv?.existing_id && <Alert level="warning">Kỳ bắt đầu {dmy(pv.start_date)} đã được chia. Chia lại sẽ thay phân bổ cũ theo cấu hình hiện tại.</Alert>}
      <SplitPreview jars={jars} sp={sp} err={err} />
    </Modal>
  );
}
