import { useState } from 'react';
import { api, rid, sendOrQueue } from '../api.js';
import { fmt, parseMoney, todayISO } from '../format.js';
import { MoneyInput, useCatalog, useToast } from './ui.jsx';

/**
 * Nhập giao dịch theo luồng: Loại → Khoản thu/chi → Ví → Số tiền → Xác nhận
 * initial: giao dịch cần sửa (nếu có)
 */
export default function TxForm({ initial, onDone, compact }) {
  const { wallets, categories, jars, settings, reload } = useCatalog();
  const toast = useToast();
  const [f, setF] = useState(() => ({
    type: initial?.type || 'expense',
    category_id: initial?.category_id || '',
    wallet_id: initial?.wallet_id || settings.default_wallet_id || '',
    to_wallet_id: initial?.to_wallet_id || '',
    amount: initial?.amount || '',
    date: initial?.date || todayISO(),
    note: initial?.note || '',
    jar_id: initial?.jar_id || '',
    exclude_balance: !!initial?.exclude_balance,
  }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const cats = categories.filter((c) => c.type === f.type);
  const wallet = wallets.find((w) => w.id === Number(f.wallet_id));
  const amount = parseMoney(f.amount);

  async function submit(e) {
    e.preventDefault();
    if (f.type !== 'transfer' && !f.category_id) return toast('Chọn khoản thu/chi', 'error');
    if (!f.wallet_id) return toast('Chọn ví', 'error');
    if (!(amount > 0)) return toast('Nhập số tiền', 'error');
    setBusy(true);
    try {
      const body = { ...f, amount, jar_id: f.jar_id || null };
      if (initial?.id) {
        await api.put(`/transactions/${initial.id}`, body);
        toast('Đã cập nhật giao dịch');
      } else {
        const verb = f.type === 'income' ? 'thu' : f.type === 'expense' ? 'chi' : 'chuyển';
        const label = `${verb} ${fmt(amount, wallet?.currency)}`;
        const r = await sendOrQueue('POST', '/transactions', { ...body, client_ref: rid() }, label);
        if (r.queued) toast(`📴 Đã lưu tạm "${label}" trên máy, sẽ tự đồng bộ khi có mạng`);
        else toast(`Đã ghi ${label}${f.exclude_balance ? ' (không tính vào số dư ví)' : ''}`);
        // cảnh báo hũ: bấm để mở chi tiết hũ và chuyển tiền từ hũ khác sang bù
        r.alerts?.forEach((a) => toast(a.message, 'error', a.jar_id ? { to: `/jars?jar=${a.jar_id}`, action: 'Chia lại hũ' } : {}));
        setF((s) => ({ ...s, amount: '', note: '' }));
      }
      reload();
      window.dispatchEvent(new Event('finora:data-changed'));
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <div className="seg" role="tablist">
          {[
            ['expense', 'Chi', 'exp'],
            ['income', 'Thu', 'inc'],
            ['transfer', 'Chuyển ví', ''],
          ].map(([t, l, c]) => (
            <button type="button" key={t} className={`${f.type === t ? 'on' : ''} ${c}`} onClick={() => setF((s) => ({ ...s, type: t, category_id: '' }))}>
              {l}
            </button>
          ))}
        </div>
        <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} style={{ width: 160 }} aria-label="Ngày" />
      </div>

      {f.type !== 'transfer' && (
        <div style={{ marginBottom: 12 }}>
          <div className="faint" style={{ marginBottom: 6 }}>1. Khoản {f.type === 'expense' ? 'chi' : 'thu'}</div>
          <div className="chips">
            {cats.map((c) => (
              <button type="button" key={c.id} className={`chip ${Number(f.category_id) === c.id ? 'on' : ''}`} onClick={() => set('category_id', c.id)}>
                {c.icon} {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="form-grid">
        <label className="field">
          {f.type === 'transfer' ? '1. Từ ví' : '2. Ví phát sinh'}
          <select value={f.wallet_id} onChange={(e) => set('wallet_id', e.target.value)}>
            <option value="">— Chọn ví —</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>{w.icon} {w.name} ({fmt(w.balance, w.currency)})</option>
            ))}
          </select>
        </label>
        {f.type === 'transfer' ? (
          <label className="field">
            2. Đến ví
            <select value={f.to_wallet_id} onChange={(e) => set('to_wallet_id', e.target.value)}>
              <option value="">— Chọn ví —</option>
              {wallets.filter((w) => w.id !== Number(f.wallet_id)).map((w) => (
                <option key={w.id} value={w.id}>{w.icon} {w.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            3. Số tiền {wallet && wallet.currency !== 'VND' ? `(${wallet.currency})` : ''}
            <MoneyInput value={f.amount} onChange={(v) => set('amount', v)} currency={wallet?.currency} />
          </label>
        )}
        {f.type === 'transfer' && (
          <label className="field">
            3. Số tiền ({wallet?.currency || 'VND'})
            <MoneyInput value={f.amount} onChange={(v) => set('amount', v)} currency={wallet?.currency} />
          </label>
        )}
        <label className={`field ${f.type === 'transfer' ? '' : compact ? 'full' : ''}`}>
          Ghi chú
          <input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Tuỳ chọn" />
        </label>
        {f.type === 'expense' && !compact && (
          <label className="field">
            Hũ (mặc định theo khoản chi)
            <select value={f.jar_id} onChange={(e) => set('jar_id', e.target.value)}>
              <option value="">Tự động</option>
              {jars.map((j) => <option key={j.id} value={j.id}>{j.icon} {j.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="tx-submit">
        <label className="check" title="Dùng cho giao dịch đã phát sinh trước khi khai báo số dư ví: vẫn hiện trong lịch sử và báo cáo thu/chi, nhưng không cộng/trừ vào ví">
          <input type="checkbox" checked={f.exclude_balance} onChange={(e) => set('exclude_balance', e.target.checked)} />
          <span>Không tính vào số dư ví<small className="faint">Đã gồm trong số dư lúc khai báo ví</small></span>
        </label>
        <button className="primary" disabled={busy}>{initial?.id ? 'Lưu thay đổi' : '✓ Xác nhận'}</button>
      </div>
    </form>
  );
}
