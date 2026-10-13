// Gửi email. Có SMTP_HOST -> gửi thật qua nodemailer; không có -> in ra console (môi trường dev).
export const devOutbox = [];

export function resetLink(token) {
  const base = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function sendMail({ to, subject, text, html }) {
  if (process.env.SMTP_HOST) {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({ from: process.env.MAIL_FROM || 'Finora <no-reply@finora.local>', to, subject, text, html });
    return { sent: true };
  }
  devOutbox.push({ to, subject, text, html, at: new Date().toISOString() });
  console.log(`\n📧 [DEV] Email tới ${to}: ${subject}\n${text}\n`);
  return { sent: false, dev: true };
}
