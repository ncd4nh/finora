# 🚀 Deploy Finora miễn phí: Vercel + Turso

| Phần | Chạy ở đâu | Chi phí |
|---|---|---|
| Giao diện (React) + API (Express) | **Vercel** (gói Hobby). API chạy dạng Serverless Function trong thư mục `api/` | Miễn phí |
| Database | **Turso** (gói Free: 5 GB, 500 triệu lượt đọc và 10 triệu lượt ghi mỗi tháng, không cần thẻ) | Miễn phí |

> Hạn mức trên là của gói miễn phí tại thời điểm viết. Hãy xem lại trang giá của Vercel và Turso. Với 1 người hoặc 1 gia đình dùng, mức này dư rất nhiều.

---

## Bước 1 · Đưa code lên GitHub

**Cài đặt (1 lần):** [Git](https://git-scm.com/download/win), [Node.js LTS](https://nodejs.org) (bản 20 trở lên), tài khoản [GitHub](https://github.com).

1. Trên GitHub bấm **New repository** → tên `finora` → **Private** → **không** tick "Add a README" → **Create repository**.
2. Mở PowerShell **trong thư mục có file `package.json`** (VD `D:\JOB\finora\finance-app`):

```powershell
git init
git add .
git commit -m "Finora: Vercel + Turso"
git branch -M main
git remote add origin https://github.com/<tên-github-của-bạn>/finora.git
git push -u origin main
```

Báo **Repository not found**: repo chưa được tạo, sai tên tài khoản trong URL, hoặc máy đang nhớ đăng nhập GitHub của tài khoản khác. Chạy `cmdkey /delete:git:https://github.com` rồi push lại để đăng nhập lại.

**Chạy thử trên máy (không cần Turso):**

```powershell
npm run setup
copy server\.env.example server\.env
npm run seed:demo      # tài khoản demo@finora.vn / finora123
npm run dev            # mở http://localhost:5173
```

Khi chưa điền `TURSO_DATABASE_URL`, dữ liệu lưu ở file `server\data\finora.db`.

---

## Bước 2 · Tạo database trên Turso

1. Vào [app.turso.tech](https://app.turso.tech) → đăng nhập bằng GitHub.
2. Tạo database mới, tên `finora`. Nếu được hỏi loại database, chọn **libSQL**. Chọn vị trí gần Việt Nam nhất trong danh sách (VD Tokyo / Singapore / Mumbai).
3. Mở database vừa tạo, lấy 2 giá trị:
   - **URL**: dạng `libsql://finora-<tên-bạn>.turso.io`
   - **Token**: bấm tạo token (quyền đọc + ghi), copy chuỗi dài `eyJ...` (chỉ hiện 1 lần).

Không cần tạo bảng: app tự tạo khi chạy lần đầu.

*Dùng dòng lệnh (macOS/Linux, hoặc WSL trên Windows):* `turso db create finora` · `turso db show finora` (xem URL) · `turso db tokens create finora` (tạo token).

---

## Bước 3 · Deploy lên Vercel

1. Vào [vercel.com](https://vercel.com) → đăng nhập bằng GitHub → **Add New… → Project** → **Import** repo `finora`.
2. Cấu hình:
   - **Root Directory**: để **trống** (thư mục gốc của repo). Đừng chọn `client`.
   - **Framework Preset**: Other. Lệnh build, cài đặt và thư mục kết quả đã khai báo sẵn trong `vercel.json`, không cần sửa.
   - **Environment Variables**:

| Biến | Giá trị |
|---|---|
| `TURSO_DATABASE_URL` | URL ở bước 2 (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | Token ở bước 2 |
| `APP_URL` | Địa chỉ Vercel, VD `https://finora.vercel.app` (điền sau khi có, rồi Redeploy) |
| `ANTHROPIC_API_KEY` | *(tuỳ chọn)* bật chat AI |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | *(tuỳ chọn)* gửi email quên mật khẩu, xem bước 5 |

3. Bấm **Deploy** → nhận địa chỉ, VD `https://finora.vercel.app`.
4. Mở `https://<địa-chỉ>/api/health`. Thấy `{"ok":true,"db":"turso"}` là API đã nối được database.
5. Vào **Settings → Environment Variables** điền `APP_URL` đúng địa chỉ → tab **Deployments** → **Redeploy**.

Từ nay mỗi lần `git push` lên `main`, Vercel tự deploy lại.

**Nên làm:** Vercel → **Settings → Functions → Function Region**, chọn vùng gần vị trí database Turso (VD Tokyo `hnd1`, Singapore `sin1`) để app phản hồi nhanh hơn.

---

## Bước 4 · (Tuỳ chọn) Tạo tài khoản demo trên database online

Trên máy, điền URL và token Turso vào `server\.env` rồi chạy:

```powershell
npm run seed:demo
```

Hoặc chỉ cần mở app và **Đăng ký**: màn đăng ký có lựa chọn tạo sẵn dữ liệu mẫu.

---

## Bước 5 · Email quên mật khẩu (Gmail)

1. Bật xác minh 2 bước cho Gmail → **Mật khẩu ứng dụng (App passwords)** → tạo mật khẩu 16 ký tự.
2. Thêm biến môi trường trên Vercel rồi Redeploy:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=ban@gmail.com
SMTP_PASS=<mật khẩu ứng dụng 16 ký tự>
MAIL_FROM=Finora <ban@gmail.com>
```

Chưa cấu hình SMTP thì app vẫn chạy, nhưng không gửi được email đặt lại mật khẩu (nội dung email chỉ in ra log trong Vercel → Logs).

---

## Cài lên điện thoại

Mở địa chỉ Vercel trên điện thoại:

- **iPhone** (Safari): Chia sẻ → *Thêm vào Màn hình chính*.
- **Android** (Chrome): ⋮ → *Cài đặt ứng dụng*.

Đăng nhập cùng tài khoản trên máy tính và điện thoại: dữ liệu tự đồng bộ sau vài giây.

## Sao lưu dữ liệu

- Turso: trang database có chức năng sao lưu / khôi phục theo thời điểm (tuỳ gói).
- Tự tải bản sao (cần Turso CLI): `turso db shell finora .dump > finora-backup.sql`

## Bản xem thử không cần database

Tạo **project Vercel thứ hai** từ cùng repo: Root Directory `client`, Build Command `npm run build:demo`, Output Directory `dist-demo`, bật *Include files outside the root directory*. Dữ liệu nằm trong trình duyệt của người xem.

## Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `/api/health` báo không kết nối được database | Kiểm tra lại `TURSO_DATABASE_URL` (bắt đầu bằng `libsql://`) và `TURSO_AUTH_TOKEN`, rồi Redeploy |
| Trang trắng / 404 khi mở `/hive` | Root Directory trên Vercel phải để trống (thư mục gốc), không phải `client` |
| Đăng nhập báo lỗi 500 | Xem Vercel → project → **Logs** để biết chi tiết |
| Lần đầu mở hơi chậm (1–2 giây) | Bình thường với serverless: function "ngủ" khi không ai dùng và khởi động lại khi có request |

## Chạy trên máy chủ riêng (VPS) thay vì Vercel

`npm run setup && npm run build && npm start` → cổng 4000 phục vụ cả giao diện và API. Có thể dùng file database trên máy chủ (bỏ trống biến Turso) hoặc vẫn dùng Turso.
