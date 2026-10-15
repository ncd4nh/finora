import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { dm, dmy, fmt, parseMoney } from '../format.js';
import { Alert, CountUp, IconPicker, Modal, MoneyInput, Progress, StatusBadge, useCatalog, useConfirm, useLoad, useToast } from '../components/ui.jsx';

const r2 = (v) => Math.round(v * 100) / 100;
/** Số tiền từng hũ (giống server): chia theo số tiền (fixed) hoặc theo % trên tổng số tiền cần phân bổ */
function splitIncome(income, rows) {
  const amounts = Object.fromEntries(rows.map((r) => [r.id, r.fixed > 0 ? r.fixed : (income * (Number(r.percent) || 0)) / 100]));
  const total = Object.values(amounts).reduce((a, b) => a + b, 0);
  // không bắt buộc chia hết: phần còn lại để ngoài các hũ
  return { amounts, total, unallocated: Math.max(0, income - total) };
}
/** Lỗi chia hũ (nếu có): tổng chia vào hũ không vượt số tiền cần phân bổ */
function splitError(sp, income) {
  if (income > 0 && sp.total > income + 0.5) return `Tổng chia vào hũ (${fmt(sp.total)}) vượt số tiền cần phân bổ (${fmt(income)})`;
  return null;
}

/** Xem trước số tiền từng hũ nhận theo cấu hình hiện tại */
function previewSplit(jars, amt) {
  const sp = splitIncome(amt, jars.map((j) => ({ id: j.id, fixed: j.fixed_amount, percent: j.percent })));
  return { sp, err: amt > 0 ? splitError(sp, amt) : null };
}
function SplitPreview({ jars, sp, err, amt }) {
  return (
    <>
      <table className="table mt" style={{ maxWidth: 560 }}>
        <tbody>
          {jars.map((j) => (
            <tr key={j.id}>
              <td><span className="dot" style={{ background: j.color, marginRight: 8 }} />{j.icon} {j.name}</td>
              <td className="r faint">{amt > 0 ? `${r2((sp.amounts[j.id] / amt) * 100)}%` : j.fixed_amount > 0 ? 'theo số tiền' : `${j.percent}%`}</td>
              <td className="r num"><b>{fmt(sp.amounts[j.id])}</b></td>
            </tr>
          ))}
          {sp.unallocated > 0.5 && (
            <tr><td className="faint">Chưa chia vào hũ</td><td /><td className="r num faint">{fmt(sp.unallocated)}</td></tr>
          )}
        </tbody>
      </table>
      {err && <p className="neg">{err}</p>}
    </>
  );
}

// ---------- Bảng chia hũ dùng chung (Cấu hình hũ, Sửa phân bổ) ----------
// Mỗi dòng: { pct, amt, exact } — pct/amt là chữ người dùng nhập; exact = % chính xác (chưa làm tròn) khi chưa sửa
const rowPct = (r) => (r.exact ?? Number(String(r.pct).replace(',', '.'))) || 0;
/** Đổi cách chia cho cả bảng, quy đổi giá trị đang có sang cách mới */
function convertRows(rows, to, income) {
  return rows.map((r) => {
    if (to === 'amount') return { ...r, amt: String(Math.round((income * rowPct(r)) / 100)) };
    const a = parseMoney(r.amt) || 0;
    const exact = income > 0 ? (a / income) * 100 : 0;
    return { ...r, pct: r2(exact), exact };
  });
}
/** Số tiền từng hũ theo các dòng đang nhập */
const splitRows = (rows, mode, income) =>
  splitIncome(income, rows.map((r) => ({ id: r.key, fixed: mode === 'amount' ? parseMoney(r.amt) || 0 : null, percent: mode === 'amount' ? 0 : rowPct(r) })));

function ModeSwitch({ mode, onMode }) {
  return (
    <div className="seg" role="group" aria-label="Cách chia">
      <button type="button" className={mode === 'pct' ? 'on' : ''} onClick={() => onMode('pct')}>Theo %</button>
      <button type="button" className={mode === 'amount' ? 'on' : ''} onClick={() => onMode('amount')}>Theo số tiền</button>
    </div>
  );
}
/** Ô nhập của 1 hũ: theo % (hiện số tiền) hoặc theo số tiền (hiện %) */
function JarValue({ name, mode, row, amount, income, onPct, onAmt }) {
  return (
    <div className="jar-cfg-val">
      {mode === 'pct' ? (
        <>
          <div className="pct-input"><input inputMode="decimal" value={row.pct} onChange={(e) => onPct(e.target.value)} aria-label={`% hũ ${name}`} /><span>%</span></div>
          <small>= {fmt(amount)}</small>
        </>
      ) : (
        <>
          <MoneyInput value={row.amt} onChange={onAmt} showHint={false} />
          <small>= {fmt(amount)} · {income > 0 ? r2((amount / income) * 100) : 0}%</small>
        </>
      )}
    </div>
  );
}

/**
 * Lấy số tiền cần phân bổ từ khoản thu lương trong kỳ: liệt kê khoản thu, tick sẵn khoản thuộc danh mục lương,
 * tổng các khoản đang tick = số tiền chia hũ
 */
function SalaryPicker({ start, end, onTotal }) {
  const { categories } = useCatalog();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [ticked, setTicked] = useState(() => new Set());
  const salaryCats = new Set(categories.filter((c) => c.type === 'income' && /lương|luong|salary/i.test(`${c.name} ${c.aliases || ''}`)).map((c) => c.id));
  const apply = (set, list) => onTotal(list.filter((t) => set.has(t.id)).reduce((s, t) => s + t.amount_base, 0));
  async function open() {
    if (rows) return setRows(null);
    try {
      const list = await api.get('/transactions' + qs({ type: 'income', from: start, to: end, limit: 200 }));
      const set = new Set(list.filter((t) => salaryCats.has(t.category_id)).map((t) => t.id));
      setRows(list);
      setTicked(set);
      if (set.size) apply(set, list);
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  function toggle(id) {
    const set = new Set(ticked);
    set.has(id) ? set.delete(id) : set.add(id);
    setTicked(set);
    apply(set, rows);
  }
  return (
    <>
      <button type="button" className="sm" onClick={open} aria-expanded={!!rows}>💰 {rows ? 'Ẩn khoản thu' : 'Lấy từ tiền lương'}</button>
      {rows && (
        <div className="salary-pick">
          <div className="faint">Khoản thu kỳ {dmy(start)} → {dmy(end)} · tick khoản dùng để chia hũ</div>
          {!rows.length && <div className="faint">Chưa có khoản thu nào trong kỳ. Ghi khoản thu "Lương" ở Giao dịch rồi lấy lại.</div>}
          {rows.map((t) => (
            <label key={t.id} className="check salary-row">
              <input type="checkbox" checked={ticked.has(t.id)} onChange={() => toggle(t.id)} />
              <span className="grow">{dm(t.date)} · {t.category_icon} {t.category_name}{t.note ? ` · ${t.note}` : ''} <span className="faint">· {t.wallet_name}</span></span>
              <b className="num">{fmt(t.amount_base)}</b>
            </label>
          ))}
          {rows.length > 0 && <div className="r faint">Tổng đã tick: <b className="num">{fmt(rows.filter((t) => ticked.has(t.id)).reduce((s, t) => s + t.amount_base, 0))}</b></div>}
        </div>
      )}
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
          <div className="faint">Chia lương vào các hũ mỗi kỳ (theo % hoặc theo số tiền), theo dõi tốc độ chi của từng hũ.</div>
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
      {showConfig && <ConfigModal onClose={() => setShowConfig(false)} onSaved={() => { if (sel === 'current') refresh(); else { setSel('current'); reloadPeriods(); } }} />}
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
      <SplitPreview jars={jars} sp={sp} err={err} amt={amt} />
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
  const { settings } = useCatalog();
  const [income, setIncome] = useState(String(st.income));
  const [mode, setMode] = useState(settings.split_mode === 'amount' ? 'amount' : 'pct');
  // giữ % chính xác của kỳ: lưu lại mà không sửa thì số tiền từng hũ không đổi
  const [rows, setRows] = useState(() => st.jars.map((j) => {
    const exact = st.income > 0 ? (j.allocated / st.income) * 100 : 0;
    return { key: j.jar_id, name: j.name, icon: j.icon, pct: r2(exact), exact, amt: String(j.allocated) };
  }));
  const upd = (i, k, v) => setRows((l) => l.map((r, x) => (x === i ? { ...r, [k]: v, ...(k === 'pct' ? { exact: null } : {}) } : r)));
  const amt = parseMoney(income);
  const sp = splitRows(rows, mode, amt);
  const err = splitError(sp, amt);
  async function save() {
    if (!(amt > 0)) return toast('Nhập số tiền cần phân bổ', 'error');
    if (err) return toast(err, 'error');
    try {
      await api.put(`/jar-periods/${st.period.id}`, { income_amount: amt, allocations: rows.map((r) => ({ jar_id: r.key, amount: Math.round(sp.amounts[r.key]) })) });
      toast('Đã cập nhật phân bổ');
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  return (
    <Modal title={`Sửa phân bổ kỳ ${dmy(st.period.start_date)} → ${dmy(st.period.end_date)}`} onClose={onClose} width={620}
      footer={<><SplitSummary sp={sp} amt={amt} err={err} /><button onClick={onClose}>Huỷ</button><button className="primary" onClick={save}>Lưu</button></>}>
      <div className="split-amount">
        <label className="field">Số tiền cần phân bổ<MoneyInput value={income} onChange={setIncome} /></label>
        <SalaryPicker start={st.period.start_date} end={st.period.end_date} onTotal={(v) => setIncome(String(v))} />
      </div>
      <div className="row between wrap mt" style={{ gap: 8 }}>
        <ModeSwitch mode={mode} onMode={(m) => { if (m !== mode) { setRows((l) => convertRows(l, m, amt)); setMode(m); } }} />
      </div>
      <div className="jar-cfg mt">
        {rows.map((r, i) => (
          <div key={r.key} className="jar-cfg-row alloc">
            <span className="jar-cfg-name">{r.icon} {r.name}</span>
            <JarValue name={r.name} mode={mode} row={r} amount={sp.amounts[r.key]} income={amt} onPct={(v) => upd(i, 'pct', v)} onAmt={(v) => upd(i, 'amt', v)} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Tổng kết dưới bảng chia hũ: đã chia bao nhiêu %, còn bao nhiêu chưa chia, hoặc lỗi */
function SplitSummary({ sp, amt, err }) {
  return (
    <div className="jar-cfg-sum" style={{ marginRight: 'auto' }}>
      {err ? <span className="neg">{err}</span> : (
        <>
          <span className="faint">Đã chia: <b className="num">{fmt(sp.total)}</b>{amt > 0 && ` (${r2((sp.total / amt) * 100)}%)`}</span>
          {amt > 0 && sp.unallocated > 0.5 && <span className="faint">Chưa chia: {fmt(sp.unallocated)}</span>}
        </>
      )}
    </div>
  );
}

function ConfigModal({ onClose, onSaved }) {
  const { jars, categories, reload } = useCatalog();
  const toast = useToast();
  const ask = useConfirm();
  const [list, setList] = useState(null);
  const [salaryDay, setSalaryDay] = useState(10);
  const [income, setIncome] = useState(''); // số tiền cần phân bổ (thường là lương)
  const [mode, setMode] = useState('pct');
  const [range, setRange] = useState(null); // kỳ hiện tại: lưu sẽ chia ngay cho kỳ này
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([api.get('/settings'), api.get('/jar-periods/current')]).then(([s, st]) => {
      const inc = st.period ? st.income : s.split_amount || st.suggested?.income_amount || 0;
      const m = s.split_mode === 'amount' || (s.split_mode !== 'pct' && jars.some((j) => j.fixed_amount > 0)) ? 'amount' : 'pct';
      setSalaryDay(s.salary_day);
      setIncome(inc ? String(inc) : '');
      setMode(m);
      setRange(st.period ? { start: st.period.start_date, end: st.period.end_date } : { start: st.suggested.start_date, end: st.suggested.end_date });
      setList(jars.map((j) => {
        // quy đổi cấu hình cũ (hũ theo số tiền / theo %) sang cách chia đang chọn
        const exact = j.fixed_amount > 0 ? (inc > 0 ? (j.fixed_amount / inc) * 100 : 0) : j.percent;
        const amt = j.fixed_amount > 0 ? j.fixed_amount : Math.round((inc * j.percent) / 100);
        return { ...j, key: j.id, pct: r2(exact), exact, amt: String(amt) };
      }));
    }).catch((e) => toast(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jars]);
  const amt = parseMoney(income);
  const upd = (i, k, v) => setList((l) => l.map((j, x) => (x === i ? { ...j, [k]: v, ...(k === 'pct' ? { exact: null } : {}) } : j)));
  const active = (list || []).filter((j) => !j.del);
  const sp = splitRows(active, mode, amt);
  const err = splitError(sp, amt);
  const removed = (list || []).filter((j) => j.del);
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
    if (!(amt > 0)) return toast('Nhập số tiền cần phân bổ (hoặc bấm "Lấy từ tiền lương")', 'error');
    if (err) return toast(err, 'error');
    setBusy(true);
    try {
      await api.put('/jars', list.map(({ key, pct, amt: a, exact, del, ...j }) => ({
        ...j,
        archived: del ? 1 : 0,
        percent: mode === 'pct' ? Math.round(rowPct({ pct, exact }) * 10000) / 10000 : 0,
        fixed_amount: mode === 'amount' ? parseMoney(a) || null : null,
        is_saving: j.is_saving ? 1 : 0,
      })));
      await api.put('/settings', { salary_day: salaryDay, split_amount: amt, split_mode: mode });
      // chia ngay cho kỳ hiện tại (chưa chia thì tạo, đã chia thì thay phân bổ) để hiện lên màn Hũ tiền
      const st = await api.post('/jar-periods', { start_date: range.start, income_amount: amt });
      toast(`Đã lưu và chia hũ kỳ ${dmy(st.period.start_date)} → ${dmy(st.period.end_date)}`);
      reload();
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Cấu hình hũ tiền" onClose={onClose} width={720}
      footer={<><SplitSummary sp={sp} amt={amt} err={err} /><button onClick={onClose}>Huỷ</button><button className="primary" disabled={busy || !list} onClick={save}>Lưu & chia hũ</button></>}>
      {!list ? <div className="faint">Đang tải…</div> : (
        <>
          <div className="split-amount">
            <label className="field">1. Số tiền cần phân bổ<MoneyInput value={income} onChange={setIncome} autoFocus /></label>
            {range && <SalaryPicker start={range.start} end={range.end} onTotal={(v) => setIncome(String(v))} />}
          </div>
          <div className="row between wrap mt" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 10 }}><span className="faint">2. Cách chia</span><ModeSwitch mode={mode} onMode={(m) => { if (m !== mode) { setList((l) => convertRows(l, m, amt)); setMode(m); } }} /></div>
            <label className="row faint" style={{ gap: 6 }}>Ngày nhận lương
              <input type="number" min={1} max={31} value={salaryDay} onChange={(e) => setSalaryDay(e.target.value)} style={{ width: 64 }} aria-label="Ngày nhận lương hằng tháng" />
            </label>
          </div>
          <div className="jar-cfg mt">
            <div className="jar-cfg-row jar-cfg-head"><span>Màu</span><span>Icon</span><span>Tên hũ</span><span>{mode === 'pct' ? 'Tỷ lệ → số tiền' : 'Số tiền → tỷ lệ'}</span><span title="Hũ tích luỹ không bị cảnh báo tốc độ chi">Tích luỹ</span><span /></div>
            {list.map((j, i) => !j.del && (
              <div className="jar-cfg-row" key={j.id || `new-${i}`}>
                <input type="color" value={j.color || '#888888'} onChange={(e) => upd(i, 'color', e.target.value)} aria-label={`Màu hũ ${j.name}`} />
                <IconPicker value={j.icon} onChange={(v) => upd(i, 'icon', v)} placeholder="🫙" label={`Biểu tượng hũ ${j.name}`} />
                <input value={j.name} onChange={(e) => upd(i, 'name', e.target.value)} aria-label="Tên hũ" />
                <JarValue name={j.name} mode={mode} row={j} amount={sp.amounts[j.key]} income={amt} onPct={(v) => upd(i, 'pct', v)} onAmt={(v) => upd(i, 'amt', v)} />
                <label className="check jar-cfg-save" title="Hũ tích luỹ không bị cảnh báo tốc độ chi">
                  <input type="checkbox" checked={!!j.is_saving} onChange={(e) => upd(i, 'is_saving', e.target.checked)} />
                  <span className="only-m">Tích luỹ</span>
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
          <button className="sm mt" onClick={() => setList((l) => [...l, { key: `new-${Date.now()}`, name: 'Hũ mới', pct: 0, exact: null, amt: '', color: '#4a3aa7', icon: '🫙', is_saving: 0 }])}>+ Thêm hũ</button>
          <p className="faint">
            {mode === 'pct' ? 'Nhập % cho từng hũ, số tiền tự tính theo số tiền cần phân bổ.' : 'Nhập số tiền cho từng hũ, % tự tính trên số tiền cần phân bổ.'}
            {' '}Không cần chia hết — phần còn lại để ngoài hũ. Bấm <b>Lưu & chia hũ</b> để chia ngay cho kỳ hiện tại{range && <> ({dmy(range.start)} → {dmy(range.end)})</>} và dùng làm mặc định cho các kỳ sau.
          </p>
        </>
      )}
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
      <SplitPreview jars={jars} sp={sp} err={err} amt={amt} />
    </Modal>
  );
}
