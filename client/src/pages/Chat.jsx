import { Fragment, useEffect, useRef, useState } from 'react';
import { api, rid, sendOrQueue } from '../api.js';
import { fmt, parseMoney, todayISO } from '../format.js';
import { Link } from 'react-router-dom';
import { Alert, useCatalog } from '../components/ui.jsx';

const KEY = 'finance-chat-v1';
const EXAMPLES = [
  'Ăn trưa 45k MoMo, cafe 25k',
  'Hôm qua đổ xăng 60k tiền mặt',
  'Hôm nay chi bao nhiêu',
  'Số dư các ví',
  'Tình hình hũ',
  'Tháng này tiêu nhiều nhất vào gì',
  'Tháng này cần tiết kiệm 5tr mua khoá học, nên chia thế nào?',
  'Bạn làm được gì?',
];

const load = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
};

/** **đậm** + xuống dòng */
function Rich({ text }) {
  return String(text || '').split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>
  );
}

export default function Chat() {
  const { settings, reload: reloadCatalog } = useCatalog();
  const [msgs, setMsgs] = useState(load);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(msgs.slice(-60))); } catch { /* bỏ qua */ }
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  const patch = (id, p) => setMsgs((m) => m.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const push = (m) => setMsgs((l) => [...l, { id: Date.now() + Math.random(), ...m }]);

  async function send(text = input) {
    text = text.trim();
    if (!text || busy) return;
    setInput('');
    push({ role: 'user', text });
    setBusy(true);
    try {
      const history = msgs.slice(-8).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text || '' })).filter((m) => m.content);
      const r = await api.post('/chat', { message: text, history });
      push({ role: 'bot', ...r });
    } catch (e) {
      push({ role: 'bot', kind: 'text', text: `⚠️ ${e.message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <h1><span className="emo">💬</span>Trợ lý chat</h1>
          <div className="faint">
            {settings.ai_enabled
              ? `⚡ Tự xử lý câu ngắn · 🤖 AI (${settings.ai_model}) hỗ trợ câu khó`
              : '⚡ Tự xử lý ngay, không cần AI: ghi thu chi, hỏi số dư, chi tiêu, hũ, mục tiêu'}
          </div>
        </div>
        {msgs.length > 0 && <button className="sm ghost" onClick={() => setMsgs([])}>Xoá lịch sử</button>}
      </div>

      <div className="chat-log" ref={logRef}>
        {!msgs.length && (
          <div className="msg bot wide">
            Chào bạn 👋 Gõ ngắn như <span className="formula">ăn trưa 45k momo</span> để ghi thu chi, hoặc hỏi <span className="formula">tháng này chi bao nhiêu</span>, <span className="formula">hũ hưởng thụ còn bao nhiêu</span>. Mình tự xử lý ngay, không cần AI.
            <div className="chips" style={{ marginTop: 10 }}>
              {EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => send(e)}>{e}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg user">{m.text}</div>
          ) : (
            <BotMsg key={m.id} m={m} last={m === msgs[msgs.length - 1]} onSend={send} onPatch={(p) => patch(m.id, p)} onDone={reloadCatalog} />
          )
        )}
        {busy && <div className="msg bot typing" aria-label="Đang xử lý"><i /><i /><i /></div>}
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder='VD: "cafe 25k momo" hoặc "tháng này chi bao nhiêu"'
          aria-label="Tin nhắn"
        />
        <button className="primary" disabled={busy || !input.trim()}>Gửi</button>
      </form>
    </div>
  );
}

function BotMsg({ m, last, onSend, onPatch, onDone }) {
  if (m.kind === 'transactions') return <TxProposal m={m} onPatch={onPatch} onDone={onDone} />;
  if (m.kind === 'advice') return <Advice m={m} onPatch={onPatch} />;
  return (
    <div className="msg bot">
      <Rich text={m.text} />
      {last && m.suggestions?.length > 0 && (
        <div className="chips" style={{ marginTop: 10, whiteSpace: 'normal' }}>
          {m.suggestions.map((s) => <button key={s} className="chip" onClick={() => onSend(s)}>{s}</button>)}
        </div>
      )}
    </div>
  );
}

// ---------- Đề xuất giao dịch: sửa được trước khi xác nhận ----------
function TxProposal({ m, onPatch, onDone }) {
  const { wallets, categories } = useCatalog();
  const [err, setErr] = useState(null);
  const items = m.items || [];
  const upd = (i, p) => onPatch({ items: items.map((x, k) => (k === i ? { ...x, ...p, error: null } : x)) });
  const valid = (it) => it.type && it.amount > 0 && it.wallet_id && (it.type === 'transfer' ? it.to_wallet_id : it.category_id);

  async function confirm() {
    try {
      const list = items.filter(valid).map((it) => ({ ...it, client_ref: it.client_ref || rid() }));
      onPatch({ items: items.map((it) => list.find((x) => x.raw === it.raw && x.amount === it.amount) || it) });
      const r = await sendOrQueue('POST', '/chat/confirm', { items: list }, `${list.length} giao dịch từ chat`);
      if (r.queued) onPatch({ confirmed: true, created: 0, text: `📴 Đã lưu tạm ${list.length} giao dịch trên máy, sẽ tự đồng bộ khi có mạng.` });
      else onPatch({ confirmed: true, created: r.created.length, alerts: r.alerts });
      onDone();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div className="msg bot wide">
      {m.confirmed ? <><span className="confirmed-tick">✅</span> <Rich text={m.created ? `Đã ghi ${m.created} giao dịch.` : m.text} /></> : <Rich text={m.text} />}
      {m.source === 'ai' && m.formulas && !m.confirmed && (
        <div className="faint" style={{ marginTop: 4 }}>Công thức: {m.formulas.map((f) => <span key={f} className="formula" style={{ marginRight: 4 }}>{f}</span>)}</div>
      )}
      {items.map((it, i) => (
        <div key={i} className={`tx-card ${!valid(it) && !m.confirmed ? 'err' : ''}`} style={m.confirmed ? { opacity: 0.75 } : undefined}>
          <select value={it.type || ''} disabled={m.confirmed} onChange={(e) => upd(i, { type: e.target.value, category_id: null })} aria-label="Loại">
            <option value="">?</option><option value="expense">Chi</option><option value="income">Thu</option><option value="transfer">Chuyển</option>
          </select>
          {it.type === 'transfer' ? (
            <select value={it.to_wallet_id || ''} disabled={m.confirmed} onChange={(e) => upd(i, { to_wallet_id: Number(e.target.value) })} aria-label="Ví nhận">
              <option value="">→ Ví nhận?</option>{wallets.map((w) => <option key={w.id} value={w.id}>→ {w.name}</option>)}
            </select>
          ) : (
            <select value={it.category_id || ''} disabled={m.confirmed} onChange={(e) => upd(i, { category_id: Number(e.target.value) })} aria-label="Khoản">
              <option value="">Khoản?</option>{categories.filter((c) => c.type === it.type).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          )}
          <select value={it.wallet_id || ''} disabled={m.confirmed} onChange={(e) => upd(i, { wallet_id: Number(e.target.value) })} aria-label="Ví">
            <option value="">Ví?</option>{wallets.map((w) => <option key={w.id} value={w.id}>{w.icon} {w.name}</option>)}
          </select>
          <input defaultValue={it.amount || ''} disabled={m.confirmed} onBlur={(e) => upd(i, { amount: parseMoney(e.target.value) })} aria-label="Số tiền" />
          {!m.confirmed ? <button className="ghost sm" onClick={() => onPatch({ items: items.filter((_, k) => k !== i) })} aria-label="Bỏ">✕</button> : <span>✓</span>}
          <div className="faint" style={{ gridColumn: '1 / -1', fontSize: 12.5 }}>
            {fmt(it.amount, it.wallet_currency)}{it.date !== todayISO() ? ` · ngày ${it.date.split('-').reverse().join('/')}` : ''}{it.note ? ` · ${it.note}` : ''}
            {it.error && <div className="neg">✕ {it.error}</div>}
            {it.warnings?.map((w) => <div key={w}>⚠ {w}</div>)}
          </div>
        </div>
      ))}
      {!m.confirmed && items.length > 0 && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary sm" disabled={!items.some(valid)} onClick={confirm}>✓ Xác nhận {items.filter(valid).length} giao dịch</button>
          <button className="sm" onClick={() => onPatch({ items: [], text: 'Đã huỷ.', confirmed: true, created: 0 })}>Huỷ</button>
        </div>
      )}
      {err && <div className="neg" style={{ marginTop: 6 }}>{err}</div>}
      {m.alerts?.map((a, i) => <div key={i} style={{ marginTop: 8 }}><Alert level={a.level}>{a.message}{a.jar_id && <> <Link to={`/jars?jar=${a.jar_id}`}>Chia lại hũ →</Link></>}</Alert></div>)}
    </div>
  );
}

// ---------- Gợi ý chia hũ ----------
function Advice({ m, onPatch }) {
  const { jars } = useCatalog();
  const [err, setErr] = useState(null);
  async function apply() {
    try {
      await api.post('/chat/apply-allocation', { income: m.income, allocations: m.allocations, period: m.period });
      onPatch({ applied: true });
    } catch (e) {
      setErr(e.message);
    }
  }
  const color = (id) => jars.find((j) => j.id === id)?.color;
  return (
    <div className="msg bot wide">
      <Rich text={m.text} />
      {m.allocations && (
        <>
          <div className="table-wrap"><table className="table" style={{ marginTop: 10, whiteSpace: 'normal' }}>
            <thead><tr><th>Hũ</th><th className="r">Đã chi</th><th className="r">Đưa thêm</th><th className="r">Tổng kỳ</th><th className="r">%</th></tr></thead>
            <tbody>
              {m.allocations.map((a) => (
                <tr key={a.jar_id}>
                  <td><span className="dot" style={{ background: color(a.jar_id), marginRight: 6 }} />{a.name}</td>
                  <td className="r num faint">{fmt(a.spent)}</td>
                  <td className="r num"><b>{fmt(a.remaining_amount)}</b></td>
                  <td className="r num">{fmt(a.amount)}</td>
                  <td className="r">{a.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="row" style={{ marginTop: 10 }}>
            {m.applied ? <span className="pos">✓ Đã áp dụng vào kỳ {m.period?.start?.split('-').reverse().join('/')}</span> : <button className="primary sm" onClick={apply}>Áp dụng phân bổ này</button>}
            <span className="faint">{m.source === 'ai' ? '🤖 AI' : '📐 Tính theo quy tắc'}</span>
          </div>
        </>
      )}
      {err && <div className="neg">{err}</div>}
    </div>
  );
}
