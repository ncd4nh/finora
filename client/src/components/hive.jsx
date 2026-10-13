// Báo cáo "Tổ ong": mỗi mục tiêu là 1 bông hoa, tiền để dành là mật, tổng tiến độ là tổ ong
import { Bee } from './icons.jsx';

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ---------- Hoa ----------
/** Đầu hoa vẽ quanh (0,0). p = 0..1 -> nụ nhỏ đến nở rộ */
export function FlowerHead({ p, size = 26, health, delay = 0 }) {
  const k = 0.42 + 0.58 * clamp01(p);
  const s = size * k;
  const petals = 6;
  const droop = health === 'behind' || health === 'overdue';
  return (
    <g className="bloom" style={{ animationDelay: `${delay}s` }}>
      {Array.from({ length: petals }, (_, i) => (
        <ellipse key={i} className="petal" cx={0} cy={-s * 0.55} rx={s * 0.36} ry={s * 0.5}
          transform={`rotate(${(360 / petals) * i + (droop ? 12 : 0)})`} opacity={droop ? 0.7 : 1} />
      ))}
      <circle className="core" r={s * 0.36} />
      {p >= 1 && <circle r={s * 0.14} fill="#fffef4" opacity=".8" />}
    </g>
  );
}

/** Icon hoa nhỏ cho danh sách */
export function FlowerIcon({ p, health, size = 46 }) {
  return (
    <svg className="hive-scene" viewBox="-30 -30 60 60" width={size} height={size} aria-hidden>
      <FlowerHead p={p} size={24} health={health} />
    </svg>
  );
}

// ---------- Tổ ong ----------
const ROWS = [3, 4, 5, 4, 3];
function hexPath(cx, cy, r) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join('L')}Z`;
}
/** Các ô của tổ (19 ô), thứ tự đổ mật: từ dưới lên, trái sang phải */
function hiveCells(r) {
  const w = Math.sqrt(3) * r;
  const cells = [];
  ROWS.forEach((n, row) => {
    const y = row * 1.5 * r;
    const x0 = -((n - 1) * w) / 2;
    for (let i = 0; i < n; i++) cells.push({ x: x0 + i * w, y: y - 3 * r, row });
  });
  return cells.sort((a, b) => b.row - a.row || a.x - b.x);
}

/** Tổ ong vẽ quanh (0,0); percent 0..100 */
export function HoneycombG({ percent, r = 16, delay = 0.2 }) {
  const cells = hiveCells(r);
  const filled = (clamp01(percent / 100) * cells.length);
  const full = Math.floor(filled);
  const part = filled - full;
  return (
    <g>
      {cells.map((c, i) => (
        <path key={i} d={hexPath(c.x, c.y, r - 1.5)}
          className={`hex ${i < full ? 'full' : i === full && part > 0.05 ? 'part' : ''}`}
          style={i < full ? { animationDelay: `${delay + i * 0.06}s` } : undefined} />
      ))}
    </g>
  );
}

function HoneyGradient({ id = 'honeyPart', p = 0.5 }) {
  return (
    <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">
      <stop offset={p} stopColor="var(--honey)" />
      <stop offset={p} stopColor="var(--surface)" />
    </linearGradient>
  );
}

/** Tổ ong nhỏ (dùng ở Tổng quan) */
export function Honeycomb({ percent, size = 120 }) {
  const cells = 19;
  const filled = clamp01(percent / 100) * cells;
  return (
    <svg className="hive-scene" viewBox="-80 -78 160 156" width={size} height={size * 0.975} role="img" aria-label={`Tổ ong đầy ${percent}%`}>
      <defs><HoneyGradient p={filled - Math.floor(filled)} /></defs>
      <HoneycombG percent={percent} r={24} />
    </svg>
  );
}

// ---------- Cảnh vườn hoa + tổ ong + ong bay ----------
export function HiveScene({ flowers, percent }) {
  const list = flowers.slice(0, 5);
  const W = 760;
  const groundY = 226;
  const hive = { x: 640, y: 128 };
  const span = 420;
  const R = 22;
  const xs = list.map((_, i) => 70 + (list.length === 1 ? span / 2 : (span * i) / Math.max(1, list.length - 1)));
  const heads = list.map((f, i) => ({
    x: xs[i],
    y: groundY - 70 - 50 * clamp01(f.percent / 100) - (i % 2) * 14,
  }));
  // Đường bay: tổ -> từng bông hoa (vòng cung) -> về tổ
  let d = `M${hive.x - 70},${hive.y + 10}`;
  [...heads].reverse().forEach((h) => { d += ` Q${h.x + 50},${h.y - 70} ${h.x},${h.y - 34}`; });
  d += ` Q${(heads[0]?.x ?? 300) + 200},${hive.y - 150} ${hive.x - 70},${hive.y + 10}`;
  const cells = 19;
  const filled = clamp01(percent / 100) * cells;
  const animate = !reduceMotion();

  return (
    <svg className="hive-scene scene" viewBox={`0 0 ${W} 290`} role="img"
      aria-label={`Vườn có ${list.length} bông hoa (mục tiêu), tổ ong đầy ${percent}%`}>
      <defs><HoneyGradient p={filled - Math.floor(filled)} /></defs>
      <rect className="ground" x="0" y={groundY} width={W} height="64" rx="18" />
      {/* cành treo tổ */}
      <path className="stem" d={`M${hive.x - 110},22 Q${hive.x},6 ${hive.x + 120},26`} />
      <path className="stem" d={`M${hive.x},14 L${hive.x},${hive.y - 4 * R + 2}`} />
      <ellipse className="leafy" cx={hive.x - 70} cy="20" rx="16" ry="7" transform={`rotate(-18 ${hive.x - 70} 20)`} />
      <g transform={`translate(${hive.x},${hive.y})`}><HoneycombG percent={percent} r={R} /></g>
      <text className="lbl" x={hive.x} y={groundY + 26} textAnchor="middle">Tổ ong {Math.round(percent)}%</text>
      <text className="lbl-sub" x={hive.x} y={groundY + 44} textAnchor="middle">tổng mật đã gom</text>

      <path className="path" d={d} />
      {list.map((f, i) => (
        <g key={f.id} className="sway" style={{ animationDelay: `${i * 0.7}s` }}>
          <path className="stem" d={`M${xs[i]},${groundY} C${xs[i] - 8},${(groundY + heads[i].y) / 2} ${xs[i] + 6},${heads[i].y + 30} ${xs[i]},${heads[i].y}`} />
          <ellipse className="leafy" cx={xs[i] + 12} cy={groundY - 34} rx="13" ry="6" transform={`rotate(-30 ${xs[i] + 12} ${groundY - 34})`} />
          <g transform={`translate(${heads[i].x},${heads[i].y})`}>
            <FlowerHead p={f.percent / 100} size={30} health={f.health} delay={0.15 + i * 0.12} />
          </g>
        </g>
      ))}
      {list.map((f, i) => (
        <g key={`l${f.id}`}>
          <text className="lbl" x={xs[i]} y={groundY + 26} textAnchor="middle">{f.name.length > 16 ? f.name.slice(0, 15) + '…' : f.name}</text>
          <text className="lbl-sub" x={xs[i]} y={groundY + 44} textAnchor="middle">{Math.round(f.percent)}% mật</text>
        </g>
      ))}

      {/* chú ong */}
      <g>
        {animate && <animateMotion dur={`${6 + list.length * 2}s`} repeatCount="indefinite" path={d} />}
        <g transform={animate ? 'translate(-26,-22)' : `translate(${hive.x - 100},${hive.y - 10})`}>
          <g style={{ animation: 'hover-bee 1.2s ease-in-out infinite' }}><Bee size={52} /></g>
        </g>
      </g>
    </svg>
  );
}
