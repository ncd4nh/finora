# 🚀 Tạo repo & deploy Finora

Finora gồm 2 phần:

| Phần | Thư mục | Chạy ở đâu |
|---|---|---|
| Giao diện (React + Vite, file tĩnh) | `client/` | **Vercel** |
| API + dữ liệu (Express + SQLite) | `server/` | Máy chủ có **ổ đĩa lưu trữ** (Railway, Render có Disk, VPS…) |

> **Vì sao không để API trên Vercel?** Vercel chạy code dạng serverless: mỗi request có thể chạy trên một máy mới và ổ đĩa không giữ lại dữ liệu. SQLite lưu dữ liệu vào file, nên đặt trên Vercel sẽ **mất dữ liệu** sau mỗi lần deploy hoặc khởi động lại. Muốn để toàn bộ trên Vercel thì phải chuyển sang database online (Turso, Postgres…), việc này cần sửa phần truy vấn.

---

## Bước 1 · Đưa code lên GitHub

**Cài đặt (1 lần):** [Git](https://git-scm.com/download/win), [Node.js LTS](https://nodejs.org) (bản 20 trở lên), tài khoản [GitHub](https://github.com).

1. Giải nén `finance-app.zip`, ví dụ vào `D:\Projects\finora`.
2. Trên GitHub bấm **New repository** → tên `finora` → chọn **Private** → **không** tick "Add a README" → **Create repository**.
3. Mở PowerShell trong thư mục dự án:

```powershell
cd D:\Projects\finora
git init
git add .
git commit -m "Finora: phiên bản đầu tiên"
git branch -M main
git remote add origin https://github.com/<tên-github-của-bạn>/finora.git
git push -u origin main
```

Lần đầu push, Git sẽ mở cửa sổ đăng nhập GitHub. File `.gitignore` đã loại sẵn `node_modules`, `server/data` (dữ liệu thật) và `.env` (mật khẩu SMTP), nên không lo lộ dữ liệu.

**Chạy thử trên máy trước khi deploy:**

```powershell
npm run setup
copy server\.env.example server\.env
npm run seed:demo      # tài khoản demo@finora.vn / finora123
npm run dev            # mở http://localhost:5173
```

---

## Bước 2 · Deploy API (ví dụ Railway)

Giao diện các nhà cung cấp có thể thay đổi đôi chút. Ý chính là: **thư mục gốc `server`, lệnh `npm start`, gắn ổ đĩa vào `/data`**.

1. Vào [railway.com](https://railway.com) → đăng nhập bằng GitHub → **New Project** → **Deploy from GitHub repo** → chọn `finora`.
2. Mở service vừa tạo → **Settings**:
   - **Root Directory**: `server`
   - Start command: `npm start` (thường tự nhận)
   - **Networking → Generate Domain** → ghi lại địa chỉ, ví dụ `https://finora-api.up.railway.app`
3. Thêm **Volume** (ổ đĩa) cho service, **Mount path**: `/data`.
4. Tab **Variables**, thêm:

| Biến | Giá trị |
|---|---|
| `DATA_DIR` | `/data` |
| `APP_URL` | địa chỉ Vercel ở bước 3, ví dụ `https://finora.vercel.app` |
| `CORS_ORIGIN` | giống `APP_URL` |
| `ANTHROPIC_API_KEY` | *(tuỳ chọn)* bật chat AI |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | gửi email quên mật khẩu (xem bước 4) |

5. Deploy xong, mở `https://<domain-api>/health`. Thấy `{"ok":true}` là API đã chạy.

*Lựa chọn khác:* Render (Web Service + Disk gắn vào `/data`) hoặc VPS chạy `node src/index.js` với pm2. Biến môi trường giống bảng trên. Gói có ổ đĩa lưu trữ thường **tính phí**, hãy xem bảng giá hiện tại của nhà cung cấp.

---

## Bước 3 · Deploy giao diện lên Vercel

1. Vào [vercel.com](https://vercel.com) → đăng nhập bằng GitHub → **Add New… → Project** → **Import** repo `finora`.
2. Cấu hình:
   - **Root Directory**: `client` (bấm Edit để chọn)
   - **Framework Preset**: Vite
   - Build Command `npm run build`, Output Directory `dist` (mặc định)
   - **Environment Variables**: `VITE_API_URL` = địa chỉ API ở bước 2, ví dụ `https://finora-api.up.railway.app` (không có `/` ở cuối)
3. Bấm **Deploy** → nhận địa chỉ, ví dụ `https://finora.vercel.app`.
4. Quay lại Railway, kiểm tra `APP_URL` và `CORS_ORIGIN` đúng bằng địa chỉ này rồi **redeploy** API.

File `client/vercel.json` đã cấu hình để mở trực tiếp các đường dẫn như `/hive` hay `/reset-password?token=…` không bị lỗi 404.

Từ nay, mỗi lần `git push` lên nhánh `main`, Vercel và Railway sẽ **tự deploy lại**.

---

## Bước 4 · Email quên mật khẩu (Gmail)

1. Bật xác minh 2 bước cho Gmail → vào **Mật khẩu ứng dụng (App passwords)** → tạo một mật khẩu 16 ký tự.
2. Điền biến môi trường cho API:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=ban@gmail.com
SMTP_PASS=<mật khẩu ứng dụng 16 ký tự>
MAIL_FROM=Finora <ban@gmail.com>
```

Chưa cấu hình SMTP thì app vẫn chạy, nhưng email chỉ được in ra log của server.

---

## Cách nhanh: chỉ deploy bản xem thử (không cần API)

Phù hợp để gửi người khác xem giao diện. Dữ liệu nằm trong trình duyệt của từng người xem, có sẵn tài khoản demo.

Tạo **project Vercel thứ hai** từ cùng repo:

- **Root Directory**: `client`
- **Build Command**: `npm run build:demo`
- **Output Directory**: `dist-demo`

Bản demo dùng chung code nghiệp vụ trong `server/src`. Nếu build báo không tìm thấy file trong `server/`, vào **Settings → Root Directory** và bật tuỳ chọn cho phép dùng file nằm ngoài thư mục gốc (Include files outside the root directory).

---

## Cài lên điện thoại

Sau khi deploy, mở địa chỉ Vercel trên điện thoại:

- **iPhone** (Safari): Chia sẻ → *Thêm vào Màn hình chính*.
- **Android** (Chrome): ⋮ → *Cài đặt ứng dụng*.

Đăng nhập cùng tài khoản trên máy tính và điện thoại: dữ liệu tự đồng bộ sau vài giây. Ghi lúc mất mạng thì app lưu tạm và tự gửi khi có mạng.

> Tính năng cài app (service worker) chỉ chạy trên **https**. Vercel đã có sẵn https.

## Sao lưu dữ liệu

Toàn bộ dữ liệu nằm trong thư mục `DATA_DIR`:

- `auth.db`: tài khoản và phiên đăng nhập
- `users/<id>.db`: dữ liệu riêng của từng người

Hãy định kỳ tải về hoặc snapshot ổ đĩa (volume).
