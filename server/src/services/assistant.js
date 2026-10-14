// Trợ lý chat chạy ngay trên máy chủ, KHÔNG cần AI / API key.
// Hiểu các câu ngắn: ghi thu chi, hỏi số dư, hỏi đã chi bao nhiêu, tình hình hũ, mục tiêu, giao dịch gần đây.
import { db } from '../db.js';
import { normalize, AMOUNT_RE, parseAmountMatch, today, addDays, pad, fmtVND, monthRange, fromISO, toISO } from '../utils.js';
import { listWallets, listGoals } from './finance.js';
import { currentStatus, currentPeriodRange, listJars } from './jars.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (n, re) => re.test(n);
const word = (w) => new RegExp(`(^|\\s)${escapeRe(w)}(?=\\s|$)`);
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// ---------- Phân loại ý định ----------
const ADVICE_RE = /(goi y|tu van|nen chia|chia hu|chia luong|chia tien|phan bo|nen tiet kiem|can tiet kiem|muon tiet kiem|nen de danh|ke hoach chi|lam sao de|lam the nao de|co nen)/;
const QUESTION_RE = /(\?|bao nhieu|(^|\s)bn(\s|$)|con (lai|bao|du)|so du|the nao|ra sao|nhu nao|(^|\s)xem(\s|$)|liet ke|thong ke|tong ket|bao cao|nhieu nhat|ton nhat|gan day|gan nhat|vua roi|moi nhat|tinh hinh|lich su|da chi|da tieu|da thu|duoc chua|het chua|vuot chua|con khong)/;
const HELP_RE = /^(help|\/help|huong dan|tro giup|giup|giup toi|ban lam duoc gi|lam duoc gi|co the lam gi|menu)\b/;
const GREET_RE = /^(chao|xin chao|hi|hello|hey|alo)\b/;
const THANKS_RE = /^(cam on|thanks|thank you|tks|ok cam on)\b/;

/** Bỏ các con số không phải tiền (tháng 9, năm 2026, 5 giao dịch, 7 ngày, 08/10) */
function stripNonMoney(n) {
  return n
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    .replace(/\b(thang|nam|tuan|ky)\s+\d{1,4}/g, ' ')
    .replace(/\d+\s*(ngay|tuan|thang|nam|giao dich|gd|khoan|lan)\b/g, ' ');
}

/** Câu có số tiền thật không (có đơn vị k/tr/... hoặc >= 1.000) */
export function moneyMatches(n) {
  return [...stripNonMoney(n).matchAll(new RegExp(AMOUNT_RE.source, 'gi'))].filter((m) => m[2] || parseAmountMatch(m) >= 1000);
}

/** 'help' | 'greet' | 'thanks' | 'advice' | 'query' | 'transactions' | 'unknown' */
export function classify(message) {
  const n = normalize(message);
  if (!n) return 'help';
  if (HELP_RE.test(n)) return 'help';
  const money = moneyMatches(n).length > 0;
  if (!money && GREET_RE.test(n)) return 'greet';
  if (!money && THANKS_RE.test(n)) return 'thanks';
  const strictTx = /(^|[,;\n]\s*)(chi|thu|chuyen|ck)\s+\d/.test(n);
  if (!strictTx && ADVICE_RE.test(n)) return 'advice';
  if (!strictTx && QUESTION_RE.test(n)) return 'query';
  if (money) return 'transactions';
  return 'unknown';
}

// ---------- Khoảng thời gian trong câu ----------
export function parseRange(n, base = today()) {
  const d = fromISO(base);
  const mk = (start, end, label) => ({ start, end: end > base ? base : end, label, explicit: true });
  let m;
  if (has(n, /hom kia/)) return mk(addDays(base, -2), addDays(base, -2), 'hôm kia');
  if (has(n, /hom qua/)) return mk(addDays(base, -1), addDays(base, -1), 'hôm qua');
  if (has(n, /hom nay|ngay nay/)) return mk(base, base, 'hôm nay');
  if ((m = n.match(/(\d+)\s*ngay\s*(qua|gan day|vua qua|truoc|gan nhat)/))) {
    const k = Math.max(1, Math.min(366, Number(m[1])));
    return mk(addDays(base, -(k - 1)), base, `${k} ngày qua`);
  }
  if (has(n, /tuan truoc|tuan roi/)) {
    const mon = addDays(base, -((d.getDay() + 6) % 7) - 7);
    return mk(mon, addDays(mon, 6), 'tuần trước');
  }
  if (has(n, /tuan nay/)) return mk(addDays(base, -((d.getDay() + 6) % 7)), base, 'tuần này');
  if ((m = n.match(/thang\s+(\d{1,2})(?:\s*(?:\/|nam)\s*(\d{4}))?/)) && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
    let y = m[2] ? Number(m[2]) : d.getFullYear();
    if (!m[2] && Number(m[1]) > d.getMonth() + 1) y -= 1; // "tháng 12" khi đang tháng 10 -> năm trước
    const r = monthRange(`${y}-${pad(m[1])}-01`);
    return mk(r.start, r.end, `tháng ${Number(m[1])}/${y}`);
  }
  if (has(n, /thang truoc|thang roi/)) {
    const r = monthRange(toISO(new Date(d.getFullYear(), d.getMonth() - 1, 1)));
    return mk(r.start, r.end, 'tháng trước');
  }
  if (has(n, /nam ngoai|nam truoc|nam roi/)) return mk(`${d.getFullYear() - 1}-01-01`, `${d.getFullYear() - 1}-12-31`, `năm ${d.getFullYear() - 1}`);
  if ((m = n.match(/nam\s+(\d{4})/))) return mk(`${m[1]}-01-01`, `${m[1]}-12-31`, `năm ${m[1]}`);
  if (has(n, /nam nay/)) return mk(`${d.getFullYear()}-01-01`, base, 'năm nay');
  if (has(n, /thang nay/)) return mk(monthRange(base).start, base, 'tháng này');
  if ((m = n.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$)/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : d.getFullYear();
    const iso = `${y}-${pad(m[2])}-${pad(m[1])}`;
    return mk(iso, iso, `ngày ${dmy(iso)}`);
  }
  return null; // không nói rõ -> người gọi tự chọn mặc định
}

// ---------- Nhận diện ví / khoản / hũ / mục tiêu trong câu ----------
const keysOf = (...names) => names.flat().filter(Boolean).map((k) => normalize(k)).filter((k) => k.length >= 2).sort((a, b) => b.length - a.length);
/** Tên mục tiêu: khớp cả cụm con >= 2 từ ("Máy ảnh Sony" -> "may anh", "anh sony") */
const phraseKeys = (name) => {
  const w = normalize(name).split(' ');
  const out = [];
  for (let i = 0; i < w.length; i++) for (let j = i + 2; j <= w.length; j++) out.push(w.slice(i, j).join(' '));
  return keysOf(out.length ? out : [name]);
};
/** Bỏ cụm chỉ thời gian trước khi tìm tên ví/khoản ("7 ngày qua" không phải "quà") */
const stripTime = (n) => n
  .replace(/(^|\s)(hom|ngay) (nay|qua|kia)(?=\s|$)/g, ' ')
  .replace(/\d+\s*ngay\s*(qua|gan day|vua qua|truoc|gan nhat)/g, ' ')
  .replace(/(^|\s)(tuan|thang|nam|ky) (nay|truoc|roi|ngoai|qua)(?=\s|$)/g, ' ')
  .replace(/(^|\s)(thang|nam)\s+\d{1,4}(\s*(\/|nam)\s*\d{4})?/g, ' ')
  .replace(/\s+/g, ' ');
function findOne(n, items) {
  let best = null;
  for (const it of items) {
    for (const k of it.keys) {
      if (word(k).test(n) && (!best || k.length > best.key.length)) best = { item: it, key: k };
    }
  }
  return best;
}

// ---------- Trả lời câu hỏi ----------
const STATUS_ICON = { ok: '🟢', warning: '🟡', danger: '🟠', over: '🔴' };
const STATUS_TEXT = { ok: 'ổn', warning: 'chi hơi nhanh', danger: 'nguy cơ vượt', over: 'đã vượt' };
const HEALTH_TEXT = { on_track: 'đúng tiến độ', ahead: 'vượt tiến độ', behind: 'chậm tiến độ', overdue: 'quá hạn', done: 'hoàn thành' };
const reply = (text, suggestions = []) => ({ kind: 'text', text, suggestions, source: 'local' });

async function sumTx({ type, start, end, category_id, wallet_id }) {
  const where = ['user_id = @uid', 'date BETWEEN ? AND ?'];
  const args = [start, end];
  if (type) { where.push('type = ?'); args.push(type); } else where.push("type <> 'transfer'");
  if (category_id) { where.push('category_id = ?'); args.push(category_id); }
  if (wallet_id) { where.push('(wallet_id = ? OR to_wallet_id = ?)'); args.push(wallet_id, wallet_id); }
  return db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount_base END),0) income,
            COALESCE(SUM(CASE WHEN type='expense' THEN amount_base END),0) expense, COUNT(*) n
     FROM transactions WHERE ${where.join(' AND ')}`
  ).get(...args);
}

async function topCategories(type, start, end, wallet_id, limit = 3) {
  return db.prepare(
    `SELECT c.name, c.icon, SUM(t.amount_base) total, COUNT(*) n FROM transactions t
     JOIN categories c ON c.id = t.category_id AND c.user_id = @uid
     WHERE t.user_id = @uid AND t.type = ? AND t.date BETWEEN ? AND ? ${wallet_id ? 'AND t.wallet_id = ?' : ''}
     GROUP BY c.id ORDER BY total DESC LIMIT ${limit}`
  ).all(...[type, start, end, wallet_id].filter((x) => x != null));
}

async function answerBalance(wallet, wallets) {
  if (wallet) {
    const w = wallets.find((x) => x.id === wallet.id);
    const cur = w.currency === 'VND' ? fmtVND(w.balance) : `${w.balance.toLocaleString('vi-VN')} ${w.currency} (≈ ${fmtVND(w.balance_base)})`;
    return reply(`${w.icon || '💳'} Số dư **${w.name}**: **${cur}**`, [`Tháng này chi bao nhiêu từ ${w.name}`, 'Số dư các ví']);
  }
  const shown = wallets.filter((w) => w.include_in_total);
  const total = shown.reduce((s, w) => s + w.balance_base, 0);
  const lines = wallets.map((w) => `• ${w.icon || '💳'} ${w.name}: ${w.currency === 'VND' ? fmtVND(w.balance) : `${w.balance.toLocaleString('vi-VN')} ${w.currency} (≈ ${fmtVND(w.balance_base)})`}`);
  return reply(`💰 Tổng tài sản: **${fmtVND(total)}**\n${lines.join('\n')}`, ['Tháng này chi bao nhiêu', 'Tình hình hũ']);
}

async function answerJars(jar) {
  const st = await currentStatus();
  if (!st) {
    const r = await currentPeriodRange();
    return reply(
      `Kỳ ${dmy(r.start)} → ${dmy(r.end)} chưa chia lương vào hũ. Gõ "chia lương 20tr" (thay bằng lương thực tế) để mình gợi ý phân bổ, hoặc vào trang **Hũ tiền**.`,
      ['Chia lương 20tr'],
    );
  }
  if (jar) {
    const j = st.jars.find((x) => x.jar_id === jar.id);
    if (!j) return reply(`Hũ ${jar.name} không có trong kỳ này.`);
    const alert = st.alerts.find((a) => a.jar_id === j.jar_id);
    return reply(
      `${j.icon || '🍯'} Hũ **${j.name}** (kỳ ${dmy(st.period.start_date)} → ${dmy(st.period.end_date)}):\n` +
        `• Ngân sách ${fmtVND(j.budget)}, đã chi ${fmtVND(j.spent)} (${j.spent_percent}%)\n` +
        `• Còn **${fmtVND(j.remaining)}** cho ${st.days_left} ngày ≈ **${fmtVND(j.daily_allowance)}/ngày**\n` +
        `• Trạng thái: ${STATUS_ICON[j.status]} ${STATUS_TEXT[j.status]}` +
        (alert ? `\n\n${alert.message}` : ''),
      ['Tình hình hũ', 'Hôm nay chi bao nhiêu'],
    );
  }
  const lines = st.jars.map((j) => `• ${STATUS_ICON[j.status]} ${j.name}: còn ${fmtVND(j.remaining)} / ${fmtVND(j.budget)}`);
  const warn = st.alerts.filter((a) => a.level !== 'info');
  return reply(
    `🍯 Kỳ ${dmy(st.period.start_date)} → ${dmy(st.period.end_date)}, đã qua ${st.time_percent}% thời gian, còn ${st.days_left} ngày.\n${lines.join('\n')}` +
      (warn.length
        ? `\n\n⚠️ Đang chi nhanh: ${st.jars.filter((j) => warn.some((a) => a.jar_id === j.jar_id)).map((j) => j.name).join(', ')}. Bấm gợi ý bên dưới để xem cách xử lý.`
        : '\n\nCác hũ đều đang ổn 👍'),
    st.jars.filter((j) => j.status !== 'ok').slice(0, 2).map((j) => `Hũ ${j.name} còn bao nhiêu`),
  );
}

async function answerGoals(goal) {
  const goals = await listGoals();
  if (!goals.length) return reply('Bạn chưa có mục tiêu tiết kiệm nào. Tạo ở trang **Mục tiêu** nhé.');
  if (goal) {
    const g = goals.find((x) => x.id === goal.id);
    return reply(
      `${g.icon || '🎯'} **${g.name}**: đã có ${fmtVND(g.saved)} / ${fmtVND(g.target_amount)} (**${g.percent}%**)\n` +
        `• Còn thiếu ${fmtVND(g.remaining)}, hạn ${g.target_date.split('-').reverse().join('/')} (${g.months_left} tháng)\n` +
        `• Cần để dành **${fmtVND(g.required_monthly)}/tháng** · ${HEALTH_TEXT[g.health]}`,
      ['Các mục tiêu tiết kiệm'],
    );
  }
  const active = goals.filter((g) => g.status === 'active');
  const lines = active.map((g) => `• ${g.icon || '🎯'} ${g.name}: ${g.percent}% · cần ${fmtVND(g.required_monthly)}/tháng · ${HEALTH_TEXT[g.health]}`);
  const need = active.reduce((s, g) => s + g.required_monthly, 0);
  return reply(
    `🌸 ${active.length} mục tiêu đang chạy, tổng cần để dành **${fmtVND(need)}/tháng**:\n${lines.join('\n')}`,
    active.slice(0, 2).map((g) => `${g.name} còn thiếu bao nhiêu`),
  );
}

async function answerRecent(n, wallet, category) {
  const m = n.match(/(\d+)\s*(giao dich|gd|khoan)/);
  const limit = Math.min(20, Math.max(1, m ? Number(m[1]) : 5));
  const where = ['t.user_id = @uid'];
  const args = [];
  if (wallet) { where.push('(t.wallet_id = ? OR t.to_wallet_id = ?)'); args.push(wallet.id, wallet.id); }
  if (category) { where.push('t.category_id = ?'); args.push(category.id); }
  const rows = await db.prepare(
    `SELECT t.*, w.name wallet_name, tw.name to_wallet_name, c.name category_name FROM transactions t
     JOIN wallets w ON w.id = t.wallet_id AND w.user_id = @uid
     LEFT JOIN wallets tw ON tw.id = t.to_wallet_id AND tw.user_id = @uid
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = @uid
     WHERE ${where.join(' AND ')} ORDER BY t.date DESC, t.id DESC LIMIT ${limit}`
  ).all(...args);
  if (!rows.length) return reply('Chưa có giao dịch nào phù hợp.');
  const sign = { expense: '−', income: '+', transfer: '⇄' };
  const lines = rows.map((t) =>
    `• ${dmy(t.date)} ${sign[t.type]}${fmtVND(t.amount_base)} ${t.type === 'transfer' ? `${t.wallet_name} → ${t.to_wallet_name}` : `${t.category_name || ''} · ${t.wallet_name}`}${t.note && t.source !== 'chat' ? ` · ${t.note}` : ''}`);
  return reply(`🧾 ${rows.length} giao dịch gần nhất${wallet ? ` của ${wallet.name}` : ''}${category ? ` (${category.name})` : ''}:\n${lines.join('\n')}`);
}

async function answerFlow(n, range, wallet, category) {
  const wantsExpense = has(n, /(^|\s)(chi|tieu|xai|het|ton|mat|tra|mua)(\s|$)/);
  const wantsIncome = has(n, /(^|\s)(thu|nhan|kiem|luong|thu nhap)(\s|$)/);
  let mode = category ? category.type : wantsExpense && !wantsIncome ? 'expense' : wantsIncome && !wantsExpense ? 'income' : 'both';
  if (has(n, /thu chi|tong ket|bao cao|tinh hinh/)) mode = 'both';
  const s = await sumTx({ type: mode === 'both' ? null : mode, start: range.start, end: range.end, category_id: category?.id, wallet_id: wallet?.id });
  const scope = `${range.label}${wallet ? ` (ví ${wallet.name})` : ''}`;
  const days = Math.round((fromISO(range.end) - fromISO(range.start)) / 864e5) + 1;
  const tips = ['Chi nhiều nhất vào gì tháng này', 'Tình hình hũ', '5 giao dịch gần nhất'];

  if (category) {
    const v = mode === 'income' ? s.income : s.expense;
    return reply(`${category.icon || ''} **${category.name}** ${scope}: **${fmtVND(v)}** (${s.n} giao dịch)`, tips);
  }
  if (mode === 'expense') {
    const top = s.n ? await topCategories('expense', range.start, range.end, wallet?.id) : [];
    return reply(
      `💸 Đã chi ${scope}: **${fmtVND(s.expense)}** (${s.n} giao dịch${days > 1 && s.n ? `, ≈ ${fmtVND(s.expense / days)}/ngày` : ''})` +
        (top.length ? `\nNhiều nhất: ${top.map((c) => `${c.icon || ''} ${c.name} ${fmtVND(c.total)}`).join(' · ')}` : ''),
      tips,
    );
  }
  if (mode === 'income') {
    const top = s.n ? await topCategories('income', range.start, range.end, wallet?.id) : [];
    return reply(
      `💰 Đã thu ${scope}: **${fmtVND(s.income)}** (${s.n} giao dịch)` +
        (top.length ? `\n${top.map((c) => `${c.icon || ''} ${c.name} ${fmtVND(c.total)}`).join(' · ')}` : ''),
      tips,
    );
  }
  const top = s.n ? await topCategories('expense', range.start, range.end, wallet?.id) : [];
  const net = s.income - s.expense;
  return reply(
    `📊 ${scope[0].toUpperCase() + scope.slice(1)}:\n• Thu: **${fmtVND(s.income)}**\n• Chi: **${fmtVND(s.expense)}**\n• Chênh lệch: **${net >= 0 ? '+' : ''}${fmtVND(net)}**` +
      (top.length ? `\nChi nhiều nhất: ${top.map((c) => `${c.icon || ''} ${c.name} ${fmtVND(c.total)}`).join(' · ')}` : ''),
    tips,
  );
}

async function answerTop(range, wallet) {
  const top = await topCategories('expense', range.start, range.end, wallet?.id, 5);
  if (!top.length) return reply(`Chưa có khoản chi nào ${range.label}.`);
  const total = top.reduce((s, c) => s + c.total, 0);
  return reply(
    `🏆 Chi nhiều nhất ${range.label}:\n${top.map((c, i) => `${i + 1}. ${c.icon || ''} ${c.name}: ${fmtVND(c.total)} (${c.n} lần)`).join('\n')}` +
      `\nTop ${top.length} chiếm ${fmtVND(total)}.`,
    ['Tình hình hũ', 'Tháng trước chi bao nhiêu'],
  );
}

/** Trả lời câu hỏi bằng dữ liệu thật; null nếu không hiểu */
export async function answerQuery(message, catalog) {
  const n = normalize(message);
  const [jars, goals, wallets] = await Promise.all([listJars(), listGoals({ status: 'active' }), listWallets()]);
  const jarItems = jars.map((j) => ({ ...j, keys: keysOf(j.name, `hu ${j.name}`, j.code) }));
  const goalItems = goals.map((g) => ({ ...g, keys: phraseKeys(g.name) }));
  const e = stripTime(n);
  const wallet = findOne(e, catalog.wallets)?.item || null;
  const jar = findOne(e, jarItems)?.item || null;
  const goal = findOne(e, goalItems)?.item || null;
  const category = jar || goal ? null : findOne(e, catalog.categories)?.item || null;
  const range = parseRange(n);
  const flowRange = range || { start: monthRange(today()).start, end: today(), label: 'tháng này' };

  if (has(n, /gan day|gan nhat|vua roi|moi nhat|lich su/) || (has(n, /giao dich/) && !has(n, /bao nhieu/))) return answerRecent(n, wallet, category);
  if (has(n, /nhieu nhat|ton nhat|(^|\s)top(\s|$)|khoan nao|vao dau|vao gi|cai gi/)) return answerTop(flowRange, wallet);
  if (jar || has(n, /(^|\s)hu(\s|$)|ngan sach|vuot/)) return answerJars(jar);
  if (goal || has(n, /muc tieu|tiet kiem duoc|de danh duoc|con thieu|(^|\s)quy(\s|$)/)) return answerGoals(goal);
  const flowWords = has(n, /(^|\s)(chi|tieu|xai|het|ton|mat|thu|nhan|kiem|luong|thu nhap|thu chi|tong ket|bao cao|tinh hinh)(\s|$)/);
  if (has(n, /so du|tai san|tong tien|con bao nhieu tien|con nhieu tien|co bao nhieu tien|trong vi|con bao nhieu|con lai/) && !flowWords && !category) return answerBalance(wallet, wallets);
  if (flowWords || category || range) return answerFlow(n, flowRange, wallet, category);
  if (wallet) return answerBalance(wallet, wallets);
  return null;
}

// ---------- Trả lời ngắn khác ----------
export const SUGGESTIONS = [
  'Ăn trưa 45k MoMo',
  'Hôm nay chi bao nhiêu',
  'Số dư các ví',
  'Tình hình hũ',
  'Tháng này tiêu nhiều nhất vào gì',
  'Tháng này cần tiết kiệm 5tr mua khoá học, nên chia thế nào?',
];

export const HELP_TEXT = `Mình hiểu các câu ngắn, không cần AI:
• **Ghi thu chi**: "ăn trưa 45k momo", "đổ xăng 60k", "lương 15tr bidv", "hôm qua cafe 30k tiền mặt". Nhiều khoản thì ngăn bằng dấu phẩy.
• **Chuyển ví**: "chuyển 2tr techcombank bidv", "rút 1tr bidv về tiền mặt".
• **Hỏi số liệu**: "hôm nay chi bao nhiêu", "tháng trước ăn uống hết bao nhiêu", "số dư BIDV", "5 giao dịch gần nhất", "tháng này tiêu nhiều nhất vào gì".
• **Hũ & mục tiêu**: "tình hình hũ", "hũ hưởng thụ còn bao nhiêu", "máy ảnh còn thiếu bao nhiêu".
• **Tư vấn chia hũ**: "chia lương 20tr", "tháng này cần tiết kiệm 5tr mua khoá học, nên chia thế nào?"
Thêm ngày bằng "hôm qua" hoặc "08/10", ghi chú sau dấu #.`;

export function smallTalk(kind) {
  if (kind === 'greet') return reply('Chào bạn 👋 Hôm nay bạn đã chi gì chưa? Gõ kiểu "ăn trưa 45k momo" là mình ghi giúp.', SUGGESTIONS.slice(0, 4));
  if (kind === 'thanks') return reply('Không có gì 🐝 Cứ ghi đều tay mỗi ngày nhé!', ['Hôm nay chi bao nhiêu']);
  return reply(HELP_TEXT, SUGGESTIONS);
}

export function notUnderstood() {
  return reply(
    'Mình chưa hiểu câu này 🤔 Thử viết ngắn hơn, có **số tiền** để ghi thu chi, hoặc hỏi kiểu "tháng này chi bao nhiêu".',
    SUGGESTIONS.slice(0, 4),
  );
}
