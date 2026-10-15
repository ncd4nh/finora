import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { dm, dmy, fmt } from '../format.js';
import { Alert, ClearDemoButton, CountUp, Progress, StatusBadge, useCatalog, useLoad } from '../components/ui.jsx';
import { IncomeExpenseBars, Legend2 } from '../components/charts.jsx';
import { FlowerIcon, Honeycomb } from '../components/hive.jsx';

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? ['🌤️', 'Chào buổi sáng'] : h < 14 ? ['☀️', 'Chào buổi trưa'] : h < 18 ? ['🌻', 'Chào buổi chiều'] : ['🌙', 'Chào buổi tối'];
}

export default function Dashboard() {
  const [d, , loading, error] = useLoad(() => api.get('/dashboard'));
  const [hive] = useLoad(() => api.get('/report/hive'));
  const { settings } = useCatalog();
  if (error) return <div className="card">Không tải được dữ liệu: {error}. Kiểm tra server đã chạy chưa.</div>;
  if (!d) return <div className="muted">{loading ? 'Đang tải…' : ''}</div>;
  const js = d.jar_status;
  const canSpendToday = js ? js.jars.filter((j) => !j.is_saving).reduce((s, j) => s + j.daily_allowance, 0) : null;
  const month = Number(d.date.slice(5, 7));
  const months6 = d.months.slice(Math.max(0, month - 6), month);
  const topAlert = js?.alerts?.[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1><span className="emo">{greeting()[0]}</span>{greeting()[1]}</h1>
          <div className="slogan" style={{ fontSize: 16, marginTop: 4 }}>🐝 Stay focus, be present.</div>
        </div>
      </div>

      {settings.has_demo && (
        <div style={{ marginBottom: 18 }}>
          <Alert level="info">
            <div className="row between wrap" style={{ gap: 8 }}>
              <span>Bạn đang xem <b>dữ liệu mẫu</b>. Khi sẵn sàng ghi chép thật, hãy xoá chúng đi.</span>
              <ClearDemoButton />
            </div>
          </Alert>
        </div>
      )}
      {topAlert && (
        <div style={{ marginBottom: 18 }}>
          <Alert level={topAlert.level}>
            {topAlert.message} <Link to="/jars">Xem hũ tiền →</Link>
          </Alert>
        </div>
      )}
      {!js && (
        <div style={{ marginBottom: 18 }}>
          <Alert level="info">Chưa chia lương cho kỳ {dmy(d.jar_period_range.start)} → {dmy(d.jar_period_range.end)}. <Link to="/jars">Chia vào hũ →</Link></Alert>
        </div>
      )}

      <div className="stats">
        <div>
          <div className="stat-label"><span className="emo-chip" aria-hidden>💰</span>Tổng tài sản</div>
          <div className="stat-value"><CountUp value={d.net_worth} /></div>
          <div className="faint">{d.wallets.length} ví · <Link to="/wallets">chi tiết</Link></div>
        </div>
        <div>
          <div className="stat-label"><span className="emo-chip" aria-hidden>📅</span>Tháng {month}</div>
          <div className={`stat-value ${d.month.net < 0 ? 'neg' : ''}`}><CountUp value={d.month.net} format={(v) => `${v > 0.5 ? '+' : ''}${fmt(v)}`} /></div>
          <div className="faint">Thu {fmt(d.month.income)} · Chi {fmt(d.month.expense)}</div>
        </div>
        <div>
          <div className="stat-label"><span className="emo-chip" aria-hidden>🛍️</span>Hôm nay còn được chi</div>
          <div className="stat-value">{canSpendToday != null ? <CountUp value={canSpendToday} /> : '—'}</div>
          <div className="faint">Đã chi hôm nay {fmt(d.today.expense)}</div>
        </div>
      </div>

      <div className="grid g-main mt">
        <div className="card">
          <div className="card-head"><h2><span className="emo">🐝</span>Tổ ong</h2><Link to="/hive" className="faint">Xem báo cáo →</Link></div>
          {hive && (
            <div className="hive-mini">
              <Honeycomb percent={hive.percent} size={120} />
              <div className="grow">
                <div className="muted" style={{ fontSize: 14 }}>Ong đã gom</div>
                <div className="stat-value" style={{ marginTop: 2 }}><CountUp value={hive.saved} /></div>
                <div className="faint">trên {fmt(hive.target)} · chuỗi {hive.streak} ngày chăm chỉ</div>
                {!hive.flowers.length && <Link to="/savings" className="faint" style={{ display: 'inline-block', marginTop: 10 }}>🌱 Trồng bông hoa đầu tiên (tạo mục tiêu tiết kiệm) →</Link>}
                <div style={{ marginTop: 10 }}>
                  {hive.flowers.filter((f) => f.status === 'active').slice(0, 3).map((f) => (
                    <div key={f.id} className="row" style={{ gap: 6, padding: '3px 0' }}>
                      <FlowerIcon p={f.percent / 100} health={f.health} size={26} />
                      <span className="grow" style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <b className="num" style={{ fontSize: 14 }}>{Math.round(f.percent)}%</b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2><span className="emo">🍯</span>Hũ tiền</h2>
            {js ? <span className="faint">Ngày {js.elapsed_days}/{js.total_days}</span> : <Link to="/jars" className="faint">Chia lương →</Link>}
          </div>
          {js ? (
            <div className="grid" style={{ gap: 12 }}>
              {js.jars.map((j) => (
                <div key={j.jar_id}>
                  <div className="row between" style={{ marginBottom: 5, fontSize: 14 }}>
                    <span className="row" style={{ gap: 7 }}><span className="dot" style={{ background: j.color }} />{j.name}</span>
                    <span className="row" style={{ gap: 6 }}>
                      {!j.is_saving && j.status !== 'ok' && <StatusBadge status={j.status} />}
                      <span className="num faint">còn {fmt(j.remaining)}</span>
                    </span>
                  </div>
                  <Progress value={j.spent} max={j.budget} color={j.color} marker={j.is_saving ? null : js.time_percent} thin label={j.name} />
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">Chưa chia lương kỳ này</div>
          )}
        </div>
      </div>

      <div className="grid g-main mt">
        <div className="card">
          <div className="card-head"><h2><span className="emo">📊</span>Thu & chi 6 tháng</h2><Legend2 /></div>
          {months6.some((m) => m.income || m.expense)
            ? <IncomeExpenseBars data={months6} height={230} />
            : <div className="empty">📊 Chưa có dữ liệu. Bấm <b>✍️ Ghi nhanh</b> (phím N) để ghi khoản đầu tiên.</div>}
        </div>
        <div className="card">
          <div className="card-head"><h2><span className="emo">🧾</span>Gần đây</h2><Link to="/transactions" className="faint">Tất cả</Link></div>
          {d.recent.slice(0, 5).map((t) => <TxRow key={t.id} t={t} />)}
          {!d.recent.length && <div className="empty">Chưa có giao dịch</div>}
        </div>
      </div>

    </>
  );
}

export function TxRow({ t, onClick, actions }) {
  const sign = t.type === 'income' ? 1 : t.type === 'expense' ? -1 : 0;
  return (
    <div className="tx-item" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="tx-ico">{t.type === 'transfer' ? '🔁' : t.category_icon || '•'}</div>
      <div className="grow">
        <div style={{ fontWeight: 550 }}>
          {t.type === 'transfer' ? `${t.wallet_name} → ${t.to_wallet_name}` : t.category_name}
          {!!t.exclude_balance && <span className="badge tx-only" title="Chỉ ghi nhận: không cộng/trừ vào số dư ví (đã gồm trong số dư khai báo)">Không tính số dư</span>}
        </div>
        <div className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dm(t.date)} · {t.type !== 'transfer' && t.wallet_name}{t.jar_name ? ` · ${t.jar_name}` : ''}{t.note ? ` · ${t.note}` : ''}
          {t.source === 'chat' && ' · 💬'}
        </div>
      </div>
      <div className={`tx-amt ${sign > 0 ? 'pos' : ''} ${t.exclude_balance ? 'faint' : ''}`}>
        {sign > 0 ? '+' : sign < 0 ? '−' : ''}{fmt(t.amount, t.wallet_currency)}
      </div>
      {actions}
    </div>
  );
}
