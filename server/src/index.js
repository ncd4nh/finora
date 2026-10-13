import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import './db.js';
import api from './routes/api.js';
import authRoutes from './routes/auth.js';
import { requireAuth } from './services/auth.js';
import { aiEnabled, MODEL } from './services/ai.js';

const app = express();
// CORS_ORIGIN: danh sách domain frontend được phép gọi API, cách nhau dấu phẩy (VD: https://finora.vercel.app)
const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(origins.length ? { origin: origins } : {}));
app.set('trust proxy', 1);
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, api);

// Phục vụ giao diện đã build (client/dist) ở chế độ production
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  const status = err.status || (err.code?.startsWith?.('SQLITE_CONSTRAINT') ? 400 : 500);
  if (status === 500) console.error(err);
  let message = err.message;
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') message = 'Tên đã tồn tại';
  res.status(status).json({ error: message });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`💰 Finance API: http://localhost:${PORT}`);
  console.log(aiEnabled() ? `🤖 AI: bật (${MODEL()})` : '🤖 AI: tắt (chưa có ANTHROPIC_API_KEY) — chat dùng bộ phân tích công thức');
});
