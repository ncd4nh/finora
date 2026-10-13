import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { dmy, fmt, short } from '../format.js';
import { CountUp, Progress, useLoad } from '../components/ui.jsx';
import { FlowerIcon, HiveScene } from '../components/hive.jsx';
import { Bee } from '../components/icons.jsx';

export const FLOWER_STATE = {
  on_track: { cls: 'good', label: 'Nở đúng hẹn' },
  ahead: { cls: 'good', label: 'Nở sớm' },
  behind: { cls: 'warn', label: 'Cần tưới thêm' },
  overdue: { cls: 'bad', label: 'Quá hạn' },
  done: { cls: 'good', label: 'Đã nở rộ' },
};

function beeNotes(r) {
  const notes = [];
  if (r.streak >= 3) notes.push(`Bạn đã ghi chép ${r.streak} ngày liên tiếp. Ong rất chăm chỉ, giữ nhịp nhé!`);
  else notes.push('Ghi chép mỗi ngày để ong không bỏ sót giọt mật nào.');
  if (r.period) {
    const pct = r.period.income ? Math.round((r.period.kept / r.period.income) * 100) : 0;
    notes.push(`Kỳ lương này đang giữ lại ${fmt(r.period.kept)} (${pct}% thu nhập).`);
    if (r.period.alerts > 0) notes.push(`Có ${r.period.alerts} hũ đang chi nhanh hơn kế hoạch. Ong cần bớt bay xa một chút.`);
  }
  r.flowers.filter((f) => f.health === 'behind' || f.health === 'overdue').forEach((f) => {
    notes.push(`Bông "${f.name}" cần tưới thêm: để dành ${fmt(f.required_monthly)}/tháng để kịp ${dmy(f.target_date)}.`);
  });
  const near = r.flowers.filter((f) => f.status === 'active').sort((a, b) => b.percent - a.percent)[0];
  if (near && near.percent >= 50) notes.push(`"${near.name}" sắp nở, chỉ còn ${fmt(near.remaining)}.`);
  return notes.slice(0, 4);
}

export default function Hive() {
  const [r] = useLoad(() => api.get('/report/hive'));
  if (!r) return null;
  const maxAbs = Math.max(1, ...r.months.map((m) => Math.abs(m.net)));

  return (
    <>
      <div className="page-head">
        <div>
          <h1><span className="emo">🐝</span>Tổ ong</h1>
          <div className="sub">Ong chăm chỉ gom mật mỗi ngày. Mỗi bông hoa là một mục tiêu, tổ đầy là bạn về đích.</div>
        </div>
        <Link to="/savings"><button>🌱 Trồng hoa mới</button></Link>
      </div>

      <div className="card" style={{ padding: '14px 14px 8px' }}>
        {r.flowers.length ? (
          <HiveScene flowers={r.flowers} percent={r.percent} />
        ) : (
          <div className="empty">Vườn chưa có hoa. <Link to="/savings">Tạo mục tiêu tiết kiệm đầu tiên →</Link></div>
        )}
      </div>

      <div className="stats mt">
        <div>
          <div className="stat-label"><span className="emo-chip" aria-hidden>🍯</span>Mật đã gom</div>
          <div className="stat-value"><CountUp value={r.saved} /></div>
          <div className="faint">trên {fmt(r.target)} · {r.percent}%</div>
        </div>
        <div>
          <div className="stat-label"><span className="emo-chip" aria-hidden>🎯</span>Cần gom mỗi tháng</div>
          <div className="stat-value"><CountUp value={r.need_monthly} /></div>
          <div className="faint">để mọi bông hoa nở đúng hẹn</div>
        </div>
        <div>
          <div className="stat-label"><span className="emo-chip" aria-hidden>🔥</span>Chuỗi ngày chăm chỉ</div>
          <div className="stat-value"><CountUp value={r.streak} format={(v) => `${Math.round(v)} ngày`} /></div>
          <div className="faint">tháng này ghi chép {r.active_days_month}/{r.days_in_month_so_far} ngày</div>
        </div>
      </div>

      <div className="grid g-main mt">
        <div className="card">
          <div className="card-head"><h2><span className="emo">🌷</span>Vườn hoa</h2><span className="faint">{r.flowers.length} mục tiêu</span></div>
          {r.flowers.map((f) => {
            const st = FLOWER_STATE[f.health] || FLOWER_STATE.on_track;
            return (
              <div key={f.id} className="flower-row">
                <FlowerIcon p={f.percent / 100} health={f.health} />
                <div className="grow">
                  <div className="row between wrap" style={{ marginBottom: 6 }}>
                    <b>{f.name}</b>
                    <span className={`badge ${st.cls}`}>{st.label}</span>
                  </div>
                  <Progress value={f.saved} max={f.target_amount} color="var(--honey-deep)" marker={f.status === 'active' ? f.time_percent : null} thin label={f.name} />
                  <div className="row between faint wrap" style={{ marginTop: 6 }}>
                    <span className="num">{fmt(f.saved)} / {fmt(f.target_amount)}</span>
                    <span>{f.status === 'active' ? `${fmt(f.required_monthly)}/tháng · hạn ${dmy(f.target_date)}` : 'Hoàn thành'}</span>
                  </div>
                </div>
                <b className="num" style={{ fontSize: 18, minWidth: 48, textAlign: 'right' }}>{Math.round(f.percent)}%</b>
              </div>
            );
          })}
          {!r.flowers.length && <div className="empty">Chưa có mục tiêu</div>}
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="card-head"><h2><span className="emo">💌</span>Lời nhắn của ong</h2></div>
            {beeNotes(r).map((n, i) => (
              <div key={i} className="bee-note" style={{ animationDelay: `${0.1 + i * 0.08}s` }}>
                <Bee size={30} /><span>{n}</span>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-head"><h2><span className="emo">🫙</span>Mật mỗi tháng</h2><span className="faint">thu − chi</span></div>
            <div className="honey-bars" role="img" aria-label="Số tiền để dành được mỗi tháng trong 6 tháng gần nhất">
              {r.months.map((m, i) => (
                <div key={m.month} className="col" title={`${m.label}: thu ${fmt(m.income)}, chi ${fmt(m.expense)}`}>
                  <span className={`v ${m.net < 0 ? 'neg' : ''}`}>{m.net ? short(m.net) : '–'}</span>
                  <div className={`jar ${m.net < 0 ? 'neg' : ''}`}
                    style={{ height: `${Math.max(4, (Math.abs(m.net) / maxAbs) * 100)}px`, animationDelay: `${0.1 + i * 0.07}s`, opacity: m.net ? 1 : 0.35 }} />
                  <span className="faint">{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
