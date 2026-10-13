// Bộ phân tích câu nhập nhanh -> giao dịch
// Công thức chuẩn:  Chi <số tiền> <khoản chi> <ví> [@ngày] [#ghi chú]
//                   Thu <số tiền> [khoản thu] <ví> [@ngày] [#ghi chú]
//                   Chuyển <số tiền> <ví nguồn> <ví đích>
// Ngoài ra hiểu câu tự nhiên đơn giản: "hôm qua dùng Techcombank mua đồ ăn hết 100k"
import { db, getSettings } from '../db.js';
import { normalize, AMOUNT_RE, parseAmountMatch, today, addDays, pad } from '../utils.js';

const EXPENSE_WORDS = ['mua', 'tra tien', 'het', 'ton', 'mat', 'dong tien', 'dong', 'nap', 'an', 'uong', 'thanh toan', 'tieu', 'chi'];
const INCOME_WORDS = ['nhan', 'duoc', 'luong', 'thuong', 'thu ve', 'hoan tien', 'ban duoc', 'lai', 'co tuc', 'thu nhap'];
const TRANSFER_WORDS = ['chuyen tien', 'chuyen', 'rut tien', 'rut', 'nap vao', 'ck'];
const FILLER = [
  'hom nay', 'hom qua', 'hom kia', 'dung', 'vi', 'tai khoan', 'tk', 'bang', 'qua', 'tu', 'sang', 'o', 'cua',
  'duoc', 'het', 'mua', 'nhan', 'tien', 'cho', 'vao', 'luc', 'toi', 'minh', 'em', 'anh', 'la', 'voi', 'trong',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (key) => new RegExp(`(^|\\s)${escapeRe(key)}(?=\\s|$)`);

export function loadCatalog() {
  const wallets = db.prepare('SELECT * FROM wallets WHERE archived = 0').all();
  const categories = db.prepare('SELECT * FROM categories WHERE archived = 0').all();
  const keysOf = (x) =>
    [x.name, ...(x.aliases || '').split(',')]
      .map((k) => normalize(k))
      .filter((k) => k.length >= 2)
      .sort((a, b) => b.length - a.length);
  return {
    wallets: wallets.map((w) => ({ ...w, keys: keysOf(w) })),
    categories: categories.map((c) => ({ ...c, keys: keysOf(c) })),
    settings: getSettings(),
  };
}

/** Tìm tất cả thực thể khớp trong chuỗi, ưu tiên khoá dài nhất; trả về [{item, key, index}] */
function findAll(text, items) {
  const hits = [];
  for (const it of items) {
    for (const k of it.keys) {
      const m = text.match(wordRe(k));
      if (m) {
        hits.push({ item: it, key: k, index: m.index + m[1].length });
        break;
      }
    }
  }
  // bỏ các match bị chứa trong match dài hơn
  hits.sort((a, b) => b.key.length - a.key.length);
  const taken = [];
  const out = [];
  for (const h of hits) {
    const s = h.index;
    const e = s + h.key.length;
    if (taken.some(([ts, te]) => s < te && e > ts)) continue;
    taken.push([s, e]);
    out.push(h);
  }
  return out.sort((a, b) => a.index - b.index);
}

function removeKey(text, key) {
  return text.replace(wordRe(key), ' ').replace(/\s+/g, ' ').trim();
}

function hasWord(text, words) {
  return words.some((w) => wordRe(w).test(text));
}

export function shortMoney(n) {
  if (n >= 1e9 && n % 1e7 === 0) return `${+(n / 1e9).toFixed(2)}tỷ`;
  if (n >= 1e6 && n % 1e4 === 0) return `${+(n / 1e6).toFixed(2)}tr`;
  if (n >= 1e3 && n % 1e3 === 0) return `${n / 1e3}k`;
  return String(n);
}

function extractDate(n) {
  let date = null;
  let text = n;
  const iso = text.match(/@(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    date = iso[1];
    text = text.replace(iso[0], ' ');
  }
  const dm = text.match(/(?:^|\s)(?:ngay\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$)/);
  if (!date && dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : new Date().getFullYear();
    date = `${y}-${pad(dm[2])}-${pad(dm[1])}`;
    text = text.replace(dm[0], ' ');
  }
  if (!date) {
    if (/\bhom kia\b/.test(text)) date = addDays(today(), -2);
    else if (/\bhom qua\b/.test(text)) date = addDays(today(), -1);
  }
  return { date: date || today(), text: text.replace(/\s+/g, ' ').trim() };
}

/** Tách đoạn văn thành từng câu giao dịch */
export function splitSegments(message) {
  const parts = String(message)
    .split(/[;\n]+|,(?!\d)|\.\s+(?=\D)|\s+(?:và|rồi|sau đó|va|roi)\s+/i)
    .map((s) => s && s.trim())
    .filter(Boolean);
  // đoạn không có số tiền -> gộp vào đoạn sau ("Hôm nay, dùng TCB mua đồ ăn 100k")
  const out = [];
  let buf = '';
  for (const p of parts) {
    const cur = buf ? `${buf} ${p}` : p;
    if (AMOUNT_RE.test(normalize(p))) {
      out.push(cur);
      buf = '';
    } else buf = cur;
  }
  if (buf) {
    if (out.length) out[out.length - 1] += ` ${buf}`;
    else out.push(buf);
  }
  return out;
}

/** Phân tích 1 câu -> giao dịch nháp */
export function parseSegment(raw, catalog = loadCatalog()) {
  const warnings = [];
  // ghi chú sau dấu #
  let note = null;
  let body = raw;
  const hashIdx = raw.indexOf('#');
  if (hashIdx >= 0) {
    note = raw.slice(hashIdx + 1).trim() || null;
    body = raw.slice(0, hashIdx);
  }
  let { date, text } = extractDate(normalize(body).replace(/[^a-z0-9\s.,/@$-]/g, ' '));

  // 1. Loại giao dịch
  let type = null;
  let strict = false;
  const verb = text.match(/^(chi|thu|chuyen khoan|chuyen|ck)\b/);
  if (verb) {
    strict = true;
    type = verb[1] === 'chi' ? 'expense' : verb[1] === 'thu' ? 'income' : 'transfer';
    text = text.slice(verb[0].length).trim();
  }

  // 2. Số tiền
  const am = text.match(AMOUNT_RE);
  let amount = parseAmountMatch(am);
  const amountHasVndUnit = am && /^(k|nghin|ngan|tr|trieu|cu|m|ty|b|d|vnd)$/i.test(am[2] || '');
  if (am) text = (text.slice(0, am.index) + ' ' + text.slice(am.index + am[0].length)).replace(/\s+/g, ' ').trim();

  // 3. Ví
  const wHits = findAll(text, catalog.wallets);

  if (!type) {
    if (wHits.length >= 2 && hasWord(text, TRANSFER_WORDS)) type = 'transfer';
    else if (hasWord(text, INCOME_WORDS) && !hasWord(text, ['mua', 'het', 'tra tien', 'thanh toan'])) type = 'income';
    else if (hasWord(text, EXPENSE_WORDS)) type = 'expense';
  }

  let wallet = null;
  let toWallet = null;
  if (type === 'transfer') {
    [wallet, toWallet] = [wHits[0]?.item, wHits[1]?.item];
  } else {
    wallet = wHits[0]?.item;
  }
  for (const h of wHits.slice(0, type === 'transfer' ? 2 : 1)) text = removeKey(text, h.key);

  // 4. Khoản thu/chi
  let category = null;
  if (type === 'income' || type === 'expense') {
    const cHits = findAll(text, catalog.categories.filter((c) => c.type === type));
    if (cHits.length) {
      category = cHits.sort((a, b) => b.key.length - a.key.length)[0].item;
      text = removeKey(text, cHits[0].key);
    }
  }

  // 5. Ghi chú: phần còn lại (bỏ từ đệm)
  if (!note) {
    let rest = ` ${text} `;
    for (const f of FILLER) rest = rest.replace(new RegExp(`\\s${escapeRe(f)}(?=\\s)`, 'g'), ' ');
    rest = rest.replace(/\b(usdt|usd|vnd|btc|eth)\b/g, ' ').replace(/\s+/g, ' ').trim();
    note = strict ? rest || null : raw.trim();
  }

  // 6. Mặc định & kiểm tra
  const item = {
    raw: raw.trim(),
    type,
    amount: null,
    wallet_id: null,
    wallet_name: null,
    wallet_currency: null,
    to_wallet_id: null,
    to_wallet_name: null,
    category_id: null,
    category_name: null,
    jar_id: null,
    date,
    note,
    warnings,
    error: null,
  };
  if (!type) item.error = 'Không xác định được là khoản thu hay chi (thêm "Chi"/"Thu" ở đầu câu)';
  else if (!amount) item.error = 'Không tìm thấy số tiền';

  if (!wallet && type) {
    const def = catalog.wallets.find((w) => w.id === catalog.settings.default_wallet_id) || catalog.wallets[0];
    if (def) {
      wallet = def;
      warnings.push(`Không nhận ra ví → dùng ví mặc định "${def.name}"`);
    } else item.error = item.error || 'Chưa có ví nào';
  }
  if (type === 'transfer' && !toWallet) item.error = item.error || 'Chuyển tiền cần 2 ví: ví nguồn và ví nhận';

  if ((type === 'income' || type === 'expense') && !category) {
    const fallbackName = type === 'expense' ? 'Chi khác' : 'Thu nhập khác';
    category =
      catalog.categories.find((c) => c.type === type && c.name === fallbackName) ||
      catalog.categories.find((c) => c.type === type);
    if (category) warnings.push(`Không nhận ra khoản ${type === 'expense' ? 'chi' : 'thu'} → xếp vào "${category.name}"`);
  }

  if (amount && wallet && wallet.currency !== 'VND' && amountHasVndUnit) {
    amount = Math.round((amount / wallet.rate_to_base) * 1e8) / 1e8;
    warnings.push(`Đã quy đổi sang ${wallet.currency} theo tỷ giá ${wallet.rate_to_base.toLocaleString('vi-VN')}`);
  }

  Object.assign(item, {
    amount,
    wallet_id: wallet?.id ?? null,
    wallet_name: wallet?.name ?? null,
    wallet_currency: wallet?.currency ?? null,
    to_wallet_id: toWallet?.id ?? null,
    to_wallet_name: toWallet?.name ?? null,
    category_id: category?.id ?? null,
    category_name: category?.name ?? null,
    jar_id: type === 'expense' ? category?.jar_id ?? null : null,
  });
  item.formula = toFormula(item);
  return item;
}

export function toFormula(it) {
  if (!it.type || !it.amount) return null;
  const amt = it.wallet_currency && it.wallet_currency !== 'VND' ? `${it.amount} ${it.wallet_currency}` : shortMoney(it.amount);
  const verb = { expense: 'Chi', income: 'Thu', transfer: 'Chuyển' }[it.type];
  const parts = [verb, amt];
  if (it.type === 'transfer') parts.push(it.wallet_name, '→', it.to_wallet_name);
  else parts.push(it.category_name, it.wallet_name);
  if (it.date !== today()) parts.push(`@${it.date}`);
  return parts.filter(Boolean).join(' ');
}

/** Có phải tin nhắn ghi giao dịch không (heuristic) */
export function looksLikeTransactions(message) {
  const n = normalize(message);
  if (/(^|[,;\n]\s*)(chi|thu|chuyen)\s+\d/.test(n)) return true;
  return AMOUNT_RE.test(n) && (hasWord(n, EXPENSE_WORDS) || hasWord(n, INCOME_WORDS)) && !looksLikeAdvice(message);
}

export function looksLikeAdvice(message) {
  const n = normalize(message);
  return /(goi y|tu van|nen chia|chia hu|phan bo|chia tien|nen tiet kiem|lam sao|the nao|bao nhieu|nen de|ke hoach)/.test(n);
}

export function parseMessage(message, catalog = loadCatalog()) {
  return splitSegments(message).map((s) => parseSegment(s, catalog));
}
