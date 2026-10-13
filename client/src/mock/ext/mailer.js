// Bản prototype không gửi email thật: lưu vào "hộp thư mô phỏng" để thử luồng quên mật khẩu
globalThis.__MOCK_OUTBOX = globalThis.__MOCK_OUTBOX || [];
export const devOutbox = globalThis.__MOCK_OUTBOX;
export function resetLink(token) {
  return `#/reset-password?token=${encodeURIComponent(token)}`;
}
export async function sendMail(mail) {
  const token = decodeURIComponent((mail.text.match(/token=([^\s]+)/) || [])[1] || '');
  devOutbox.push({ ...mail, token, at: new Date().toISOString() });
  return { sent: false, mock: true };
}
