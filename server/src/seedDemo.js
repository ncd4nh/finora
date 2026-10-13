// Tạo tài khoản demo + dữ liệu mẫu: npm run seed:demo
// Tài khoản: demo@finora.vn / finora123 (đổi bằng biến DEMO_EMAIL, DEMO_PASSWORD)
import 'dotenv/config';
import { authDb, runWithUser } from './db.js';
import { register } from './services/auth.js';
import { hasTransactions, seedDemo } from './demoData.js';

const email = process.env.DEMO_EMAIL || 'demo@finora.vn';
const password = process.env.DEMO_PASSWORD || 'finora123';
let user = authDb.prepare('SELECT * FROM users WHERE email = ?').get(email);
if (!user) {
  await register({ name: 'Bạn Ong', email, password });
  user = authDb.prepare('SELECT * FROM users WHERE email = ?').get(email);
  console.log(`👤 Đã tạo tài khoản ${email} / ${password}`);
}
runWithUser(user.id, () => {
  if (hasTransactions() && !process.argv.includes('--force')) {
    console.log('Tài khoản đã có giao dịch, bỏ qua (dùng --force để vẫn tạo).');
    return;
  }
  seedDemo();
  console.log('✅ Đã tạo dữ liệu mẫu cho', email);
});
