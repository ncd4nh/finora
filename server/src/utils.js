// Tiện ích dùng chung: ngày tháng, kỳ lương, chuẩn hoá chuỗi, đọc số tiền

export const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD' theo giờ local */
export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> Date (local, 00:00) */
export function fromISO(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  return toISO(new Date());
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function daysBetween(a, b) {
  // số ngày từ a đến b (b - a)
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

function salaryDate(y, m, day) {
  // Ngày lương trong tháng (kẹp về cuối tháng nếu tháng không đủ ngày)
  const nm = new Date(y, m, 1);
  const yy = nm.getFullYear();
  const mm = nm.getMonth();
  return new Date(yy, mm, Math.min(day, daysInMonth(yy, mm)));
}

/**
 * Kỳ lương chứa ngày `iso`. VD ngày lương = 10:
 * 2026-10-09 -> 2026-09-10 .. 2026-10-09 ; 2026-10-10 -> 2026-10-10 .. 2026-11-09
 */
export function getPeriod(iso, salaryDay = 10) {
  const d = fromISO(iso);
  let start = salaryDate(d.getFullYear(), d.getMonth(), salaryDay);
  if (d < start) start = salaryDate(d.getFullYear(), d.getMonth() - 1, salaryDay);
  const next = salaryDate(start.getFullYear(), start.getMonth() + 1, salaryDay);
  next.setDate(next.getDate() - 1);
  return { start: toISO(start), end: toISO(next) };
}

export function monthRange(iso) {
  const d = fromISO(iso);
  const s = new Date(d.getFullYear(), d.getMonth(), 1);
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: toISO(s), end: toISO(e) };
}

export function yearRange(iso) {
  const y = fromISO(iso).getFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

/** Số tháng (làm tròn lên, tối thiểu 1) giữa 2 ngày */
export function monthsBetween(a, b) {
  const days = daysBetween(a, b);
  return Math.max(1, Math.ceil(days / 30.4375));
}

/** Bỏ dấu tiếng Việt + lowercase + gộp khoảng trắng */
export function normalize(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[()\[\]{}"'“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Regex bắt số tiền dạng: 100k, 1.5tr, 1tr5, 2 triệu, 500.000, 500,000đ, 1m, 2 trieu 5, 3 ty, 20$
 * Áp dụng trên chuỗi đã normalize.
 */
export const AMOUNT_RE =
  /(?<![a-z\d.,])(\d+(?:[.,]\d+)*)\s*(k|nghin|ngan|tr|trieu|cu|m|ty|b|d|vnd|\$|usd)?(\d{1,3})?(?!\d|[.,]\d|[a-z])/i;

export function parseAmountMatch(m) {
  if (!m) return null;
  let [, num, unit = '', tail] = m;
  unit = unit.toLowerCase();
  const mult = { k: 1e3, nghin: 1e3, ngan: 1e3, tr: 1e6, trieu: 1e6, cu: 1e6, m: 1e6, ty: 1e9, b: 1e9 }[unit] || 1;
  let value;
  if (mult === 1) {
    // 500.000 / 500,000 -> nghìn phân cách ; 12.5 -> thập phân
    if (/^\d{1,3}([.,]\d{3})+$/.test(num)) value = Number(num.replace(/[.,]/g, ''));
    else value = Number(num.replace(',', '.'));
  } else {
    value = Number(num.replace(',', '.')) * mult;
    // "1tr5" = 1.5tr ; "2 trieu 500" = 2.5tr ; "1k2" = 1200
    if (tail) {
      const frac = Number(`0.${tail}`);
      value += frac * mult;
    }
  }
  return Number.isFinite(value) ? Math.round(value * 1e8) / 1e8 : null;
}

export function parseAmount(str) {
  return parseAmountMatch(normalize(str).match(AMOUNT_RE));
}

export function fmtVND(n) {
  return `${Math.round(n || 0).toLocaleString('vi-VN')}đ`;
}

export function round(n, d = 0) {
  const f = 10 ** d;
  return Math.round((n || 0) * f) / f;
}
