export const fmt = (n, cur = 'VND') => {
  if (n == null || Number.isNaN(n)) return '—';
  if (cur && cur !== 'VND') return `${Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 8 })} ${cur}`;
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
};
/** Rút gọn: 1.250.000 -> 1,25tr */
export const short = (n) => {
  const a = Math.abs(n || 0);
  const s = n < 0 ? '-' : '';
  if (a >= 1e9) return `${s}${+(a / 1e9).toFixed(2)} tỷ`;
  if (a >= 1e6) return `${s}${+(a / 1e6).toFixed(1)}tr`;
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)}k`;
  return `${s}${Math.round(a)}`;
};
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
export const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
/** Đọc số tiền người dùng gõ: "1.5tr", "100k", "1.000.000" */
export const parseMoney = (s) => {
  if (typeof s === 'number') return s;
  const t = String(s || '').trim().toLowerCase().replace(/\s/g, '');
  const m = t.match(/^([\d.,]+)(k|tr|m|ty)?(\d{0,3})$/);
  if (!m) return Number(t) || 0;
  let [, num, unit, tail] = m;
  const mult = { k: 1e3, tr: 1e6, m: 1e6, ty: 1e9 }[unit] || 1;
  let v = mult === 1 ? Number(/^\d{1,3}([.,]\d{3})+$/.test(num) ? num.replace(/[.,]/g, '') : num.replace(',', '.')) : Number(num.replace(',', '.')) * mult;
  if (tail && mult > 1) v += Number(`0.${tail}`) * mult;
  return v || 0;
};
export const WALLET_TYPES = {
  bank: 'Ngân hàng', cash: 'Tiền mặt', ewallet: 'Ví điện tử', investment: 'Đầu tư', crypto: 'Crypto', other: 'Khác',
};
