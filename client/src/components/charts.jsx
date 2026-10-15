import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmt, short } from '../format.js';

/** Giữ nguyên mảng dữ liệu khi nội dung không đổi: recharts thấy mảng mới là chạy lại animation từ đầu (giật) */
function useStable(data, map = (x) => x) {
  const key = JSON.stringify(data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => map(data), [key]);
}

/** Đọc màu từ CSS token (tự cập nhật khi đổi sáng/tối) */
function useTokens(names) {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--${n}`).trim()]));
  };
  const [t, setT] = useState(read);
  useEffect(() => {
    // cập nhật khi đổi sáng/tối của hệ điều hành hoặc đổi theme trong app
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => setT(read());
    mq.addEventListener('change', fn);
    const mo = new MutationObserver(fn);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener('change', fn); mo.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return t;
}

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="t">{payload[0]?.payload?.tipLabel || label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: p.color }} />
          <span className="muted">{p.name}:</span>
          <b className="num">{fmt(p.value)}</b>
        </div>
      ))}
      {payload.length === 2 && (
        <div className="faint" style={{ marginTop: 4 }}>Chênh lệch: {fmt(payload[0].value - payload[1].value)}</div>
      )}
    </div>
  );
}

export function Legend2() {
  return (
    <div className="legend">
      <span><i className="dot" style={{ background: 'var(--income)' }} />Thu</span>
      <span><i className="dot" style={{ background: 'var(--expense)' }} />Chi</span>
    </div>
  );
}

/** Thu - chi theo tháng (cột nhóm) */
export function IncomeExpenseBars({ data: raw, height = 260 }) {
  const t = useTokens(['income', 'expense', 'surface-2']);
  const data = useStable(raw);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickFormatter={short} tickLine={false} axisLine={false} width={48} />
        <Tooltip content={<Tip />} cursor={{ fill: t['surface-2'] }} />
        <Bar dataKey="income" name="Thu" fill={t.income} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={900} animationEasing="ease-out" />
        <Bar dataKey="expense" name="Chi" fill={t.expense} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={900} animationEasing="ease-out" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Chi tiêu theo ngày (đường) */
export function DailyLine({ data, height = 220 }) {
  const t = useTokens(['income', 'expense', 'text-3', 'surface']);
  const d = useStable(data, (a) => a.map((x) => ({ ...x, tipLabel: x.date.split('-').reverse().join('/') })));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={d} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={4} />
        <YAxis tickFormatter={short} tickLine={false} axisLine={false} width={48} />
        <Tooltip content={<Tip />} cursor={{ stroke: t['text-3'], strokeDasharray: '3 3' }} />
        <Line dataKey="expense" name="Chi" stroke={t.expense} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: t.surface, strokeWidth: 2 }} animationDuration={1100} animationEasing="ease-out" />
      </LineChart>
    </ResponsiveContainer>
  );
}
