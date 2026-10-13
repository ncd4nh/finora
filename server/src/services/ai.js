// Kết nối Claude API (tuỳ chọn). Không có API key -> hệ thống vẫn chạy bằng bộ phân tích quy tắc.
import Anthropic from '@anthropic-ai/sdk';
import { today } from '../utils.js';

let client = null;
export function aiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}
export const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

export async function complete({ system, messages, max_tokens = 1500 }) {
  const res = await getClient().messages.create({ model: MODEL(), system, messages, max_tokens });
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Lấy khối JSON đầu tiên trong câu trả lời */
export function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Hiểu ý định tin nhắn + chuyển câu tự nhiên thành công thức chuẩn.
 * Trả về { intent: 'transactions'|'advice'|'chat', formulas: string[], reply: string }
 */
export async function interpret(message, catalog, history = []) {
  const wallets = catalog.wallets.map((w) => `- ${w.name} (${w.currency}; gọi tắt: ${w.aliases || '-'})`).join('\n');
  const cats = (t) =>
    catalog.categories
      .filter((c) => c.type === t)
      .map((c) => c.name)
      .join(', ');
  const system = `Bạn là trợ lý tài chính cá nhân nói tiếng Việt. Hôm nay là ${today()}.
Nhiệm vụ: đọc tin nhắn người dùng, xác định ý định và (nếu là ghi thu/chi) chuyển thành CÔNG THỨC chuẩn.

Công thức (mỗi giao dịch 1 dòng):
- Chi <số tiền> <Khoản chi> <Ví> [@YYYY-MM-DD] [#ghi chú]
- Thu <số tiền> <Khoản thu> <Ví> [@YYYY-MM-DD] [#ghi chú]
- Chuyển <số tiền> <Ví nguồn> <Ví nhận> [@YYYY-MM-DD] [#ghi chú]
Số tiền viết dạng 100k, 1.5tr, 2tr, 500000. Chỉ thêm @ngày khi khác hôm nay. Dùng ĐÚNG tên ví/khoản bên dưới.

Ví hiện có:
${wallets}
Khoản chi: ${cats('expense')}
Khoản thu: ${cats('income')}

Trả về DUY NHẤT một JSON:
{"intent":"transactions"|"advice"|"chat","formulas":["..."],"reply":"câu trả lời ngắn gọn bằng tiếng Việt"}
- intent "advice": người dùng hỏi cách chia hũ / lập kế hoạch tiết kiệm / phân bổ tiền.
- intent "chat": câu hỏi khác; trả lời ngắn trong "reply".`;
  const text = await complete({
    system,
    messages: [...history.slice(-6), { role: 'user', content: message }],
    max_tokens: 800,
  });
  const j = extractJson(text) || { intent: 'chat', formulas: [], reply: text };
  return { intent: j.intent || 'chat', formulas: Array.isArray(j.formulas) ? j.formulas : [], reply: j.reply || '' };
}
