# Demo script — 8 phút

## Chuẩn bị trước

- Ưu tiên production-local: tạo `.env.production` theo `docs/deployment.md`, rồi `docker compose -f compose.production.yaml --env-file .env.production up -d --build`.
- Seed demo là thao tác phá dữ liệu hiện có; chỉ chạy `npm run seed` khi đã xác nhận đúng database demo.
- Mặc định `AI_MODE=fallback` và `ANOMALY_AI_MODE=fallback`. Muốn chọn Barista live phải cấu hình base URL, raw `AI_MODEL`, key và mode trong `.env.production`, giữ anomaly fallback nếu không chủ động bật, rồi recreate API/worker containers. Dev backend dùng `server/.env`, không phải `.env` ở repo root.
- Hiện không có credential provider live; demo chỉ được mô tả là fallback, không tuyên bố live đã được kiểm chứng. Bằng chứng HTTP 401 là lượt lịch sử ngày 22/09/2026, không phải kết quả mới.
- Chỉ chạy live smoke khi đã có credential/quota và DB demo sẵn sàng: khi cả ba case đạt sẽ có đúng ba request thật, một request/case; lệnh dừng ở case đầu không đạt.

  ```bash
  npm run build:contracts
  npm -w @may-cafe/server exec -- tsx scripts/ai-live-smoke.ts
  ```

- Mở Guest portal `http://localhost:8080` và kiểm tra `http://localhost:8080/healthz`.
- Trên điện thoại cùng mạng Wi-Fi, mở `http://<IP-máy>:8080/t/<token-bàn-01>`. Lấy token từ log khi seed và đặt `PUBLIC_APP_URL` theo IP LAN trước khi xoay QR.
- Mở sẵn:
  - 1 tab guest trên điện thoại (hoặc tab ẩn danh).
  - 1 tab guest thứ hai trên trình duyệt khác.
  - 1 tab Staff `http://localhost:8081/staff/kds` (login `staff.a@maycafe.vn / MayCafe@2025`).
  - 1 tab Admin `http://localhost:8082/admin/operations`.

## Kịch bản

| Thời gian | Thao tác | Giá trị |
| --- | --- | --- |
| 0:00–0:30 | Giới thiệu: QR + AI Barista + Realtime + bảo mật | Đặt bối cảnh |
| 0:30–1:30 | Trên admin, đổi trạng thái "Cà phê Sữa Đá" → tạm hết | Quản trị thời gian thực |
| 1:30–3:00 | Trên guest, hỏi AI "Trà ít ngọt, dưới 50 nghìn", chọn Trà Đào, tùy chỉnh size M, đường 30%, topping trân châu | AI gắn menu, tùy chỉnh |
| 3:00–4:00 | Thêm vào giỏ + đặt món; quan sát KDS đồng thời đón đơn mới | Realtime |
| 4:00–5:00 | Trên KDS, chuyển đơn CONFIRMED → PREPARING → READY → SERVED | State machine đúng |
| 5:00–5:45 | Mở thiết bị thứ hai vào cùng bàn, đặt thêm 1 món; chứng minh hai đơn riêng, giỏ riêng | Đa thiết bị |
| 5:45–6:30 | Khách gửi "Yêu cầu thanh toán"; Staff chuyển phiên sang CHECKOUT, xem bill, thu tiền, phiên đóng | Vòng đời phiên |
| 6:30–7:00 | Mở dashboard, lọc 30 ngày, KPI, biểu đồ ngày/giờ, top sản phẩm | Báo cáo từ dữ liệu thật |
| 7:00–7:30 | Mở Operations: instance/dependency/alert có timestamp, dữ liệu thiếu ghi rõ | Observability thật |
| 7:30–8:00 | Hỏi AI ở `AI_MODE=fallback` → xác nhận UI nói rõ fallback; đối chiếu biên bản Zen thật ngày 06/10/2026, gồm live đạt và một timeout sau chuyên hoá. Smoke 401 ngày 22/09/2026 là bằng chứng lịch sử | Không giả live hoặc hứa chất lượng |

## Phương án dự phòng khi mất mạng

- Có thể dùng LAN; nếu dùng tunnel/HTTPS phải cập nhật đúng origin, cookie Secure và proxy WebSocket theo `docs/deployment.md`.
- AI fallback luôn hoạt động không cần internet ngoài.
- Realtime: nếu socket mất kết nối, UI vẫn lấy dữ liệu qua REST (TanStack Query refetch mỗi 8–30s tùy trang).

Camera/in QR thật chưa nằm trong kết quả nghiệm thu hiện tại. Khi test sau, dùng domain/IP mà điện thoại truy cập được và xác nhận cookie, redirect `/t/<token>` → `/menu`, Socket.IO reconnect và receipt sau thanh toán.
