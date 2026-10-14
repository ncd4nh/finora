// Ứng dụng Express (dùng chung cho: chạy máy chủ thường `npm start` và Vercel serverless `api/index.js`)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { init } from './db.js';
import api from './routes/api.js';
import authRoutes from './routes/auth.js';
import { requireAuth } from './services/auth.js';

const app = express();
// CORS_ORIGIN: chỉ cần khi giao diện và API ở 2 domain khác nhau (VD: https://finora.vercel.app)
const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(origins.length ? { origin: origins } : {}));
app.set('trust proxy', 1);
app.get(['/health', '/api/health'], async (_req, res) => {
  try {
    await init();
    res.json({ ok: true, db: process.env.TURSO_DATABASE_URL ? 'turso' : 'file' });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Không kết nối được database: ${e.message}` });
  }
});
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, api);

app.use((err, _req, res, _next) => {
  const constraint = /SQLITE_CONSTRAINT|constraint failed/i.test(`${err.code} ${err.message}`);
  const status = err.status || (constraint ? 400 : 500);
  if (status === 500) console.error(err);
  let message = err.message;
  if (/UNIQUE/i.test(message)) message = 'Tên đã tồn tại';
  else if (status === 500) message = 'Lỗi máy chủ, vui lòng thử lại';
  res.status(status).json({ error: message });
});

export default app;
