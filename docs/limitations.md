# Hạn chế đã biết

Cập nhật mục AI ngày 06/10/2026; các trạng thái còn lại phản ánh snapshot 23/09/2026. Xem [bộ nhớ dự án](../PROJECT_MEMORY.md) và [test report](test-report.md).

- **AI Barista mới có smoke provider thật giới hạn**: Zen `space-bunny-free` đã trả `llm` cho ba case trước chuyên hoá và một case kết hợp sau chuyên hoá ngày 06/10/2026; một case mới timeout 15 giây và fallback. Chưa benchmark chất lượng, skill-vs-baseline, chi phí hoặc latency đại diện. Backend chỉ hỗ trợ native Chat Completions với Bearer auth/JSON-object mode; live cần model/key tường minh. `ANOMALY_AI_MODE` độc lập, mặc định `fallback`; HTTP 401 ngày 22/09/2026 là bằng chứng lịch sử. Xem [ai-evaluation.md](ai-evaluation.md).
- **MongoDB cần replica set** để dùng transaction; compose.yaml đã cấu hình nhưng cần Docker Desktop chạy. Test integration dùng `mongodb-memory-server` để thay thế.
- **Ảnh món lấy từ Unsplash** — chưa upload asset riêng. Có thể thay bằng pipeline upload trong P2.
- **Chưa có Vercel/Netlify deployment** — README hướng dẫn chạy local; production deploy cần thêm reverse proxy + HTTPS config.
- **Thanh toán online chưa tích hợp** — chỉ "xác nhận tại quầy" trong P0. P2 sẽ thêm sandbox (Stripe/MoMo/VNPay).
- **QR đổi thủ công** — admin đã đổi token và tải ảnh PNG; chưa xoay/thu hồi theo lịch.
- **Không có giỏ cộng tác** — mỗi thiết bị có giỏ riêng (theo yêu cầu P0).
- **PWA không gửi đơn offline** — chỉ cache app shell/assets; API mutation và Socket.IO luôn cần mạng. Giỏ được giữ để người dùng thử lại khi online.
- **Dashboard có lọc ngày, CSV và in/PDF**, nhưng chưa có analytics nâng cao theo cohort/khách hàng vì khách không có tài khoản.
- **Không có analytics nâng cao cho chủ quán** — chỉ KPI cơ bản + top sản phẩm.
