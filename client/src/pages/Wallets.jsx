import { useState } from 'react';
import { api } from '../api.js';
import { fmt, parseMoney, WALLET_TYPES } from '../format.js';
import { CountUp, Modal, MoneyInput, useCatalog, useConfirm, useToast } from '../components/ui.jsx';
import TxForm from '../components/TxForm.jsx';

const ICONS = { bank: '🏦', cash: '💵', ewallet: '📱', investment: '📈', crypto: '🪙', other: '👛' };

export default function Wallets() {
  const { wallets, reload } = useCatalog();
  const [edit, setEdit] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const [transfer, setTransfer] = useState(false);
  const total = wallets.filter((w) => w.include_in_total).reduce((s, w) => s + w.balance_base, 0);
  const groups = Object.keys(WALLET_TYPES)
    .map((t) => ({ t, items: wallets.filter((w) => w.type === t) }))
    .filter((g) => g.items.length);

  return (
    <>
      <div className="page-head">
        <div>
          <h1><span className="emo">👛</span>Ví tiền</h1>
          <div className="faint">Tổng tài sản quy đổi: <b><CountUp value={total} /></b></div>
        </div>
        <div className="row">
          <button onClick={() => setTransfer(true)}>🔁 Chuyển ví</button>
          <button className="primary" onClick={() => setEdit({})}>+ Thêm ví</button>
        </div>
      </div>

      {groups.map((g) => {
        const sum = g.items.reduce((s, w) => s + w.balance_base, 0);
        return (
          <div key={g.t} style={{ marginBottom: 20 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <h2>{ICONS[g.t]} {WALLET_TYPES[g.t]}</h2>
              <span className="num muted">{fmt(sum)} · {total ? Math.round((sum / total) * 100) : 0}%</span>
            </div>
            <div className="grid g3 stagger">
              {g.items.map((w) => (
                <div key={w.id} className="card lift" style={{ borderTop: `3px solid ${w.color || 'var(--border)'}` }}>
                  <div className="row between">
                    <b>{w.icon} {w.name}</b>
                    <span className="badge">{w.currency}</span>
                  </div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{fmt(w.balance, w.currency)}</div>
                  {w.currency !== 'VND' && (
                    <div className="faint num">≈ {fmt(w.balance_base)} · tỷ giá {fmt(w.rate_to_base)}</div>
                  )}
                  {!w.include_in_total && <div className="faint">Không tính vào tổng tài sản</div>}
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="sm" onClick={() => setEdit(w)}>Sửa</button>
                    <button className="sm" onClick={() => setAdjust(w)}>Cập nhật số dư</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {edit && <WalletModal w={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      {adjust && <AdjustModal w={adjust} onClose={() => setAdjust(null)} onSaved={reload} />}
      {transfer && (
        <Modal title="Chuyển tiền giữa các ví" onClose={() => setTransfer(false)}>
          <TxForm initial={{ type: 'transfer' }} onDone={() => setTransfer(false)} />
        </Modal>
      )}
    </>
  );
}

function WalletModal({ w, onClose, onSaved }) {
  const toast = useToast();
  const ask = useConfirm();
  const [f, setF] = useState({
    name: w.name || '', type: w.type || 'bank', currency: w.currency || 'VND', rate_to_base: w.rate_to_base || 1,
    initial_balance: w.initial_balance ?? '', aliases: w.aliases || '', icon: w.icon || '', color: w.color || '#2a78d6',
    include_in_total: w.include_in_total ?? 1, note: w.note || '',
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  async function save() {
    try {
      const body = { ...f, initial_balance: parseMoney(f.initial_balance), rate_to_base: Number(f.rate_to_base) || 1, icon: f.icon || ICONS[f.type] };
      if (w.id) await api.put(`/wallets/${w.id}`, body);
      else await api.post('/wallets', body);
      toast('Đã lưu ví');
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function remove() {
    if (!(await ask(`Xoá ví "${w.name}"?`))) return;
    const r = await api.del(`/wallets/${w.id}`);
    toast(r.message || 'Đã xoá ví');
    onSaved();
    onClose();
  }
  return (
    <Modal
      title={w.id ? 'Sửa ví' : 'Thêm ví'}
      onClose={onClose}
      footer={<>{w.id && <button className="danger" onClick={remove} style={{ marginRight: 'auto' }}>Xoá</button>}<button onClick={onClose}>Huỷ</button><button className="primary" onClick={save}>Lưu</button></>}
    >
      <div className="form-grid">
        <label className="field full">Tên ví<input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="VD: Techcombank" autoFocus /></label>
        <label className="field">Loại
          <select value={f.type} onChange={(e) => set('type', e.target.value)}>
            {Object.entries(WALLET_TYPES).map(([k, v]) => <option key={k} value={k}>{ICONS[k]} {v}</option>)}
          </select>
        </label>
        <label className="field">Mệnh giá (đơn vị tiền)
          <input list="currencies" value={f.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          <datalist id="currencies">{['VND', 'USD', 'USDT', 'BTC', 'ETH', 'EUR', 'JPY', 'GOLD'].map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        {f.currency !== 'VND' && (
          <label className="field full">Tỷ giá: 1 {f.currency} = ? VND
            <input inputMode="decimal" value={f.rate_to_base} onChange={(e) => set('rate_to_base', e.target.value)} />
          </label>
        )}
        <label className="field">Số dư ban đầu ({f.currency})
          <MoneyInput value={f.initial_balance} onChange={(v) => set('initial_balance', v)} currency={f.currency} />
        </label>
        <label className="field">Biểu tượng / màu
          <div className="row"><input value={f.icon} onChange={(e) => set('icon', e.target.value)} placeholder={ICONS[f.type]} style={{ width: 70 }} /><input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} style={{ padding: 2, height: 38 }} /></div>
        </label>
        <label className="field full">Tên gọi tắt cho chat (cách nhau dấu phẩy)
          <input value={f.aliases} onChange={(e) => set('aliases', e.target.value)} placeholder="VD: tcb, techcom" />
        </label>
        <label className="row full" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={!!f.include_in_total} onChange={(e) => set('include_in_total', e.target.checked ? 1 : 0)} style={{ width: 'auto' }} />
          Tính vào tổng tài sản
        </label>
      </div>
    </Modal>
  );
}

function AdjustModal({ w, onClose, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState('');
  async function save() {
    const r = await api.post(`/wallets/${w.id}/adjust`, { actual_balance: parseMoney(v) });
    toast(r.diff ? `Đã điều chỉnh ${fmt(r.diff, w.currency)}` : 'Số dư không đổi');
    onSaved();
    onClose();
  }
  return (
    <Modal title={`Cập nhật số dư · ${w.name}`} onClose={onClose} footer={<><button onClick={onClose}>Huỷ</button><button className="primary" onClick={save}>Lưu</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Số dư trên hệ thống: <b>{fmt(w.balance, w.currency)}</b>. Nhập số dư thực tế, hệ thống sẽ ghi một giao dịch điều chỉnh phần chênh lệch.</p>
      <label className="field">Số dư thực tế<MoneyInput value={v} onChange={setV} autoFocus currency={w.currency} /></label>
    </Modal>
  );
}
