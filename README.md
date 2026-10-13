# 🐝 Finora — Stay focus, be present

Web app quản lý thu chi gồm: Dashboard, Ví tiền, Danh mục thu/chi, Giao dịch, Mục tiêu tiết kiệm, Hũ tiền (chia lương theo %), Chat AI nhập nhanh & tư vấn chia hũ.

**Công nghệ:** Node.js 18+ · Express · SQLite (better-sqlite3) · React 18 + Vite · Recharts · Claude API (tuỳ chọn).

## Chạy nhanh

```bash
npm run setup              # cài thư viện cho server + client
cp server/.env.example server/.env   # (Windows: copy server\.env.example server\.env)
npm run seed:demo          # (tuỳ chọn) tạo tài khoản demo@finora.vn / finora123 kèm dữ liệu mẫu
npm run dev                # API :4000 + giao diện :5173
```
Mở http://localhost:5173

**Chạy production (1 cổng):** `npm run build && npm start` → mở http://localhost:4000

**Bản prototype 1 file HTML (không cần server):** `cd client && npm run build:proto` → `client/dist-proto/finora.html`.
Bản này chạy nguyên logic backend ngay trong trình duyệt (SQLite WebAssembly), dữ liệu mẫu lưu ở localStorage.

**Giao diện:** theme theo logo Finora (kem, xanh lá, cam, vàng mật), chế độ Sáng / Tối / Tự động. Trang **Tổ ong** báo cáo tiến độ: mỗi mục tiêu là 1 bông hoa, tiền để dành là mật, tổng tiến độ là tổ ong (API `/api/report/hive`). Có hiệu ứng chuyển trang, số chạy, thanh tiến độ, hộp thoại; tự tắt khi hệ điều hành bật "giảm chuyển động".

Dữ liệu lưu trong `server/data/`: `auth.db` (tài khoản, phiên đăng nhập) và `users/<id>.db` (dữ liệu riêng của từng người). Sao lưu bằng cách copy thư mục này.
Nếu đang có `data/finance.db` từ bản cũ, tài khoản đầu tiên đăng ký sẽ nhận lại toàn bộ dữ liệu đó.

## Tài khoản

- Đăng ký / đăng nhập bằng email + mật khẩu (≥ 8 ký tự, có chữ và số). Mật khẩu băm bằng scrypt, phiên đăng nhập 30 ngày (chỉ lưu SHA-256 của token).
- **Tài khoản** (bấm ảnh đại diện → Tài khoản & bảo mật): đổi tên, email, ảnh đại diện (tải ảnh lên — tự cắt vuông 256px — hoặc chọn biểu tượng), đổi mật khẩu (đăng xuất các thiết bị khác).
- **Quên mật khẩu**: gửi email chứa liên kết đặt lại (hiệu lực 30 phút, dùng 1 lần). Cấu hình `SMTP_*`, `MAIL_FROM`, `APP_URL` trong `server/.env`; chưa cấu hình thì nội dung email được in ra console.
- Giới hạn số lần thử đăng nhập / gửi email để chống dò mật khẩu.


## Điện thoại & đồng bộ

- **Giao diện điện thoại**: thanh điều hướng dưới cùng (🏠 · 🧾 · ＋ · 💬 · ☰), nút ＋ ghi nhanh ở giữa, hộp thoại trượt từ dưới lên, vùng chạm ≥ 44px, ô nhập 16px (iPhone không tự phóng to).
- **Cài như app (PWA)**: iPhone (Safari) bấm Chia sẻ → *Thêm vào Màn hình chính*; Android (Chrome) bấm ⋮ → *Cài đặt ứng dụng*. Mở toàn màn hình, vẫn mở được khi mất mạng.
- **Đồng bộ nhiều thiết bị**: dữ liệu lưu trên máy chủ theo tài khoản. Mỗi lần dữ liệu thay đổi, server tăng "phiên bản" (`GET /api/sync`). Các thiết bị khác kiểm tra mỗi 10 giây (và ngay khi mở lại app / có mạng lại) rồi tự tải lại, kèm thông báo "Đã cập nhật thay đổi từ thiết bị khác".
- **Ghi khi offline**: khoản thu/chi ghi lúc mất mạng được lưu tạm trên máy (biểu tượng ⏳ trên thanh), có mạng lại thì tự gửi. Mỗi khoản có mã `client_ref` nên gửi lại không bị trùng.
- **Thiết bị đang đăng nhập**: trang Tài khoản liệt kê các thiết bị (VD "iPhone · Safari"), có thể đăng xuất từ xa.

## Deploy

Xem hướng dẫn tạo repo GitHub và deploy (Vercel + Railway) trong **[DEPLOY.md](DEPLOY.md)**.

## Chat AI

- **Không cần API key**: chat vẫn hiểu công thức và câu đơn giản, tư vấn chia hũ bằng thuật toán quy tắc.
- **Có API key** (điền `ANTHROPIC_API_KEY` trong `server/.env`): Claude hiểu câu tự nhiên phức tạp → chuyển thành công thức, và diễn giải/tinh chỉnh gợi ý chia hũ. Đổi model ở `ANTHROPIC_MODEL`.

| Bạn gõ | Hệ thống hiểu |
|---|---|
| `Chi 100k Ăn uống Techcombank, Thu 500k BIDV` | 2 giao dịch |
| `Hôm nay dùng ví Techcombank mua đồ ăn hết 100k, nhận lương ở BIDV được 500k` | `Chi 100k Ăn uống Techcombank` · `Thu 500k Lương BIDV` |
| `Chuyển 2tr Techcombank BIDV` | Chuyển ví |
| `Chi 45k grab MoMo 08/10 #đi làm` | Có ngày + ghi chú |
| `Tháng này cần tiết kiệm 5tr mua khoá học, nên chia lương còn lại thế nào?` | Gợi ý phân bổ hũ + nút **Áp dụng** |

Số tiền: `100k`, `1.5tr`, `1tr5`, `2 triệu`, `500.000`. Ngày: `hôm qua`, `hôm kia`, `dd/mm`. Mọi giao dịch từ chat đều hiện thẻ để **sửa rồi xác nhận**.
Nhận diện ví/khoản dựa trên tên + **"tên gọi tắt"** (khai báo ở màn Ví tiền / Danh mục, VD `tcb, techcom`).

## Nghiệp vụ chính

- **Ví**: ngân hàng, tiền mặt, ví điện tử, đầu tư, crypto… mỗi ví có mệnh giá riêng (VND, USD, USDT, BTC…) + tỷ giá quy đổi VND. Số dư = số dư ban đầu ± giao dịch. Có "Cập nhật số dư" để khớp với thực tế.
- **Giao dịch**: Chọn khoản thu/chi → ví → số tiền → Xác nhận. Khoản chi tự gắn vào hũ theo danh mục.
- **Hũ tiền**: mặc định 6 hũ (Thiết yếu 55%, Hưởng thụ 10%, Giáo dục 10%, Tiết kiệm dài hạn 10%, Tự do tài chính 10%, Cho đi 5%) — sửa được. Kỳ chạy từ **ngày lương (mặc định 10)** đến ngày 9 tháng sau.
- **Cảnh báo chi quá mức**: so % ngân sách đã chi với % thời gian đã qua của kỳ.
  - chi nhanh hơn thời gian > 10% → *Chi nhanh*; > 25% hoặc gấp 1,5 lần → *Nguy cơ vượt*; vượt ngân sách → *Vượt*.
  - Kèm mức được chi/ngày so với kế hoạch, số tiền cần bù để quay lại mức chi bình thường, và hũ có thể chuyển sang (ưu tiên hũ không phải Thiết yếu, mỗi hũ cho mượn tối đa 20% phần kế hoạch còn lại; nút chuyển 1 chạm). Hũ tích luỹ không bị cảnh báo.
- **Tiết kiệm**: mục tiêu (số tiền + hạn) → tự tính cần để dành bao nhiêu/tháng, tiến độ so với thời gian, trạng thái đúng/chậm tiến độ. Ngắn hạn ≤ 1 năm, dài hạn > 1 năm.

## Cấu trúc

```
server/src/
  db.js                 # schema SQLite + dữ liệu mặc định
  utils.js              # kỳ lương, đọc số tiền, bỏ dấu
  services/finance.js   # ví, giao dịch, tiết kiệm
  services/jars.js      # hũ tiền, kỳ lương, cảnh báo
  services/parser.js    # phân tích câu nhập nhanh
  services/advisor.js   # gợi ý chia hũ
  services/ai.js        # Claude API
  routes/api.js         # REST API /api/*
client/src/pages/       # Dashboard, Wallets, Categories, Transactions, Savings, Jars, Chat
client/src/mock/        # lớp giả lập để chạy backend trong trình duyệt (prototype)
```

API chính: `/api/dashboard`, `/api/wallets`, `/api/categories`, `/api/transactions`, `/api/savings`, `/api/jars`, `/api/jar-periods`, `/api/chat`, `/api/chat/confirm`.

Chưa có đăng nhập — dùng cá nhân trên máy / mạng nội bộ. Nếu đưa lên internet cần thêm xác thực.
