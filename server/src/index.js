// Chạy như máy chủ Node thông thường (máy cá nhân, VPS): npm start
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { fileURLToPath } from 'node:url';
import app from './app.js';
import { init } from './db.js';
import { aiEnabled, MODEL } from './services/ai.js';

// Phục vụ giao diện đã build (client/dist) ở chế độ production
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) {
  const web = express.Router();
  web.use(express.static(dist));
  web.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use(web);
}

const PORT = Number(process.env.PORT) || 4000;
await init();
app.listen(PORT, () => {
  console.log(`💰 Finora API: http://localhost:${PORT}`);
  console.log(process.env.TURSO_DATABASE_URL ? `🗄️  Database: Turso (${process.env.TURSO_DATABASE_URL})` : `🗄️  Database: file ${process.env.DATA_DIR || 'server/data'}/finora.db`);
  console.log(aiEnabled() ? `🤖 AI: bật (${MODEL()})` : '🤖 AI: tắt (chưa có ANTHROPIC_API_KEY) — chat dùng bộ phân tích công thức');
});
