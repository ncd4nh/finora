import { useMemo, useState } from 'react';
import { api, qs } from '../api.js';
import { dmy, fmt, todayISO } from '../format.js';
import { Modal, useCatalog, useConfirm, useLoad, useToast } from '../components/ui.jsx';
import TxForm from '../components/TxForm.jsx';
import { TxRow } from './Dashboard.jsx';

const monthStart = () => todayISO().slice(0, 8) + '01';

export default function Transactions() {
  const { wallets, categories, reload: reloadCatalog } = useCatalog();
  const toast = useToast();
  const ask = useConfirm();
  const [flt, setFlt] = useState({ from: monthStart(), to: todayISO(), type: '', wallet_id: '', category_id: '', q: '' });
  const [rows, reload] = useLoad(() => api.get('/transactions' + qs({ ...flt, limit: 1000 })), [JSON.stringify(flt)]);
  const [edit, setEdit] = useState(null);
  const set = (k, v) => setFlt((s) => ({ ...s, [k]: v }));

  const sum = useMemo(() => {
    const s = { income: 0, expense: 0 };
    rows?.forEach((t) => t.type !== 'transfer' && (s[t.type] += t.amount_base));
    return s;
  }, [rows]);
  const byDay = useMemo(() => {
    const m = new Map();
    rows?.forEach((t) => (m.has(t.date) ? m.get(t.date).push(t) : m.set(t.date, [t])));
    return [...m.entries()];
  }, [rows]);

  async function remove(t) {
    if (!(await ask('Xoá giao dịch này?'))) return;
    await api.del(`/transactions/${t.id}`);
    toast('Đã xoá');
    reload();
    reloadCatalog();
  }

  return (
    <>
      <div className="page-head"><h1><span className="emo">🧾</span>Giao dịch</h1></div>
      <div className="card tx-quick-card">
        <div className="card-head"><h2><span className="emo">⚡</span>Ghi nhanh</h2><span className="faint">Chọn khoản → ví → số tiền → Xác nhận</span></div>
        <TxForm compact onDone={reload} />
      </div>

      <div className="card mt">
        <div className="row wrap filters" style={{ gap: 8, marginBottom: 12 }}>
          <input type="date" value={flt.from} onChange={(e) => set('from', e.target.value)} style={{ width: 150 }} aria-label="Từ ngày" />
          <input type="date" value={flt.to} onChange={(e) => set('to', e.target.value)} style={{ width: 150 }} aria-label="Đến ngày" />
          <select value={flt.type} onChange={(e) => set('type', e.target.value)} style={{ width: 130 }} aria-label="Loại">
            <option value="">Tất cả loại</option><option value="expense">Chi</option><option value="income">Thu</option><option value="transfer">Chuyển ví</option>
          </select>
          <select value={flt.wallet_id} onChange={(e) => set('wallet_id', e.target.value)} style={{ width: 160 }} aria-label="Ví">
            <option value="">Tất cả ví</option>{wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select value={flt.category_id} onChange={(e) => set('category_id', e.target.value)} style={{ width: 170 }} aria-label="Khoản">
            <option value="">Tất cả khoản</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.type === 'income' ? '↑' : '↓'} {c.name}</option>)}
          </select>
          <input value={flt.q} onChange={(e) => set('q', e.target.value)} placeholder="Tìm ghi chú…" style={{ width: 170 }} />
        </div>
        <div className="row wrap" style={{ gap: 16, marginBottom: 8 }}>
          <span>Thu: <b className="num pos">{fmt(sum.income)}</b></span>
          <span>Chi: <b className="num">{fmt(sum.expense)}</b></span>
          <span>Chênh lệch: <b className={`num ${sum.income - sum.expense < 0 ? 'neg' : 'pos'}`}>{fmt(sum.income - sum.expense)}</b></span>
          <span className="faint">{rows?.length || 0} giao dịch</span>
        </div>
        {byDay.map(([date, list]) => (
          <div key={date} style={{ marginTop: 10 }}>
            <div className="faint" style={{ fontWeight: 600, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>{dmy(date)}</div>
            {list.map((t) => (
              <TxRow key={t.id} t={t} onClick={() => setEdit(t)}
                actions={<button className="ghost sm danger" onClick={(e) => { e.stopPropagation(); remove(t); }} aria-label="Xoá">🗑</button>} />
            ))}
          </div>
        ))}
        {rows && !rows.length && <div className="empty">Không có giao dịch</div>}
      </div>

      {edit && (
        <Modal title="Sửa giao dịch" onClose={() => setEdit(null)}>
          <TxForm initial={edit} onDone={() => { setEdit(null); reload(); }} />
        </Modal>
      )}
    </>
  );
}
