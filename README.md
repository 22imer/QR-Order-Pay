# Fantastic cafe — QR Ordering & AI Barista

Trạng thái triển khai và ghi nhớ cho lần làm việc tiếp theo: [PROJECT_MEMORY.md](PROJECT_MEMORY.md).
Kết quả kiểm chứng mới nhất: [docs/test-report.md](docs/test-report.md).
Bối cảnh thiết kế, nhận diện và các file quan trọng: [docs/design-context.md](docs/design-context.md).

Một hệ thống MERN (MongoDB + Express + React + Node.js) đặt đồ uống qua QR tại bàn, tích hợp AI Barista tư vấn món. Mục tiêu là bài tập lớn Lập trình Web: chạy trên dữ liệu thật, kiến trúc phân tầng rõ ràng, giao diện chỉn chu, có kiểm thử, OpenAPI và tài liệu bảo vệ.

## Tính năng chính

- Màn hình tại bàn hiển thị QR tự đổi mỗi 60 giây; khách quét mã còn hạn để vào phiên bằng Wi-Fi hoặc 4G.
- Thực đơn đa danh mục, tùy chỉnh size/đường/đá/topping, ghi chú.
- Quản trị xóa mềm/khôi phục món; xóa danh mục trống hoặc chuyển toàn bộ món sang danh mục khác rồi xóa. Ẩn danh mục áp dụng cả menu, tìm kiếm, AI và kiểm tra giỏ cũ. Xem [quản lý vòng đời catalog](docs/catalog-lifecycle.md).
- Thực đơn khách dạng ảnh nền toàn màn hình và thẻ món ngang: chọn thẻ đổi ảnh, tên, mô tả và giá; bấm **Chọn món** để tùy chỉnh và thêm giỏ.
- Tìm kiếm menu bằng câu tiếng Việt có/không dấu, typo nhẹ, ngân sách và ràng buộc caffeine/sữa; kết quả rỗng minh bạch và có bộ lọc sửa tay.
- AI Barista gợi ý món từ menu thật theo sở thích & ngân sách (có fallback minh bạch khi không có API key).
- Giao diện khách đồng bộ nền xanh đậm/chữ sáng/nút vàng từ thực đơn đến AI, tùy chỉnh món, giỏ, đơn và đánh giá; hóa đơn in dùng nền trắng.
- Giỏ hàng theo thiết bị, quote ký trước khi đặt và idempotency khi gửi đơn.
- KDS có tuổi công đoạn/SLA, duyệt yêu cầu hủy; staff có màn hình báo hết món, chuyển bàn và đối soát ca.
- Realtime qua Socket.IO cho cả guest và staff.
- Thanh toán trước từng đơn: Staff xác nhận đã nhận đủ tiền thì đơn mới vào KDS. Khách gọi thêm thanh toán tiếp; đóng phiên mới chốt hóa đơn bất biến và thu hồi quyền gọi món.
- Thu từng phần, hiển thị đã thu/còn thiếu; khóa thu tiền theo phiên bàn, điều chỉnh khoản thu có quản lý khác duyệt, lịch sử đảo/thay thế và đối soát ca. Xem [quy trình xử lý thanh toán](docs/payment-safeguards.md).
- Đánh giá riêng từng đơn ngay khi đã thanh toán và phục vụ xong, vẫn tiếp tục gọi thêm; hóa đơn sau đóng phiên giữ đánh giá đã gửi và cho đánh giá các đơn còn thiếu.
- Staff/Admin cấp liên kết riêng cho thiết bị hiển thị QR tại từng bàn; token QR tĩnh cũ không còn được dùng để vào bàn.
- Dashboard doanh thu, lịch sử/in lại hóa đơn snapshot, biểu đồ ngày/giờ và top sản phẩm.
- Dashboard vận hành riêng cho ADMIN: dependency, hàng đợi, socket, lỗi HTTP, tài nguyên và thời gian công đoạn.
- Detector bất thường định kỳ cho lỗi/độ trễ/pha chế/hủy đơn, có baseline, “chưa đủ dữ liệu”, bằng chứng, cooldown và giải thích fallback an toàn.
- PWA giữ giao diện và giỏ khi mất mạng, hiển thị trạng thái kết nối; đơn chỉ được gửi khi online.
- Dashboard lọc theo ngày, xuất CSV và in/PDF; tiền thu/hoàn/điều chỉnh tính theo ngày giao dịch tại Việt Nam. Top món tính theo ngày tạo đơn đã thanh toán.
- Đánh yêu cầu gọi nhân viên và yêu cầu thanh toán.
- Phân quyền ADMIN/STAFF/GUEST kiểm tra cả HTTP và socket.

## Stack

- **Server**: Node.js 24 LTS, Express + Mongoose + TypeScript, JWT, bcryptjs, Socket.IO + Redis adapter, Zod, Pino, Prometheus metrics.
- **Client**: Vite + React + TypeScript, Tailwind, Radix UI, TanStack Query, Zustand, Recharts, Lucide.
- **AI**: OpenAI-compatible (mặc định) với fallback rule-based dựa trên menu.
- **Tests**: Vitest + Supertest + Playwright + k6; GitHub Actions chạy quality/integration.

## Cài đặt nhanh

```bash
npm ci
npm run db:up          # khởi MongoDB replica set
npm run db:wait        # đợi sẵn sàng
npm run db:migrate     # áp migration/index có lock và checksum
npm run seed           # reset dữ liệu demo, in liên kết màn hình từng bàn
npm run dev            # chạy client + server
```

- Server: `http://localhost:4000`
- Client: `http://localhost:5173`

## Tài khoản demo (mật khẩu `MayCafe@2025`)

- `admin@maycafe.vn` (ADMIN)
- `staff.a@maycafe.vn` (STAFF)
- `staff.b@maycafe.vn` (STAFF)

Khi seed, mỗi bàn in ra liên kết `/display#…`. Mở liên kết riêng này trên thiết bị tại bàn; khách chỉ quét QR hiển thị bên trong. Với dữ liệu đang sử dụng, cấp liên kết ở trang Staff **Bàn & phiên**, không chạy lại seed. Xem [hướng dẫn QR động và thanh toán trước](docs/qr-prepayment.md).

## Luồng khách: quét QR → đặt món

1. Khách quét QR còn hạn trên màn hình tại bàn → `POST /api/v1/table-sessions/join`.
2. Nếu bàn **chưa có phiên**, server tự mở phiên mới (`source: 'GUEST'`, có audit log) và trả `created: true`, kèm `guestSessionId` / `participantId` để đặt món. Thao tác này **idempotent** và an toàn khi nhiều người quét cùng lúc: hai request đồng thời chỉ tạo đúng một phiên, cả hai nhận cùng `tableSessionId`.
3. Nếu bàn **đang có phiên**, khách được đưa vào đúng phiên đó (`created: false`) — không tạo phiên trùng.
4. Khách gửi đơn ở trạng thái `AWAITING_PAYMENT / UNPAID`. Nhân viên kiểm tra đã nhận đủ tiền từng đơn thì đơn chuyển `PENDING / PAID` và xuất hiện trên KDS.
5. Khách gọi thêm không cần quét lại, mỗi đơn mới thanh toán riêng. QR hết hạn không thu hồi quyền của khách đã vào bàn.

Khi khách rời bàn, Staff đóng phiên sau khi phục vụ/hủy hết đơn, thu đủ tiền và xử lý yêu cầu hủy. Server **chốt thành `Bill` bất biến** trong cùng transaction, thu hồi quyền gọi món và QR cũ. Bàn trở lại trạng thái tự do; khách lượt sau quét QR mới để mở phiên. Bản ghi `Bill` chỉ ghi một lần (unique theo `tableSessionId`), không có API sửa/xóa. Xác nhận tiền từng đơn không đóng phiên.

> Nếu quán muốn giữ quyền kiểm soát của nhân viên, đặt `GUEST_AUTO_OPEN=false`: khách quét QR lúc bàn chưa mở phiên sẽ nhận `403` với thông báo _"Bàn chưa mở phiên phục vụ, vui lòng báo nhân viên."_ như hành vi cũ.

## Cấu hình phiên bàn

| Biến                       | Mặc định | Ý nghĩa                                                                                                                            |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GUEST_AUTO_OPEN`          | `true`   | Khách quét QR tự mở phiên khi bàn trống. `false` = quay lại hành vi cũ (403 "Bàn chưa mở phiên phục vụ, vui lòng báo nhân viên."). |
| `SESSION_IDLE_TIMEOUT_MIN` | `60`     | Tự đóng phiên tự mở (`source: 'GUEST'`) không có đơn nào sau N phút, ghi `closedReason: 'IDLE'`. `0` = tắt sweeper.                |

## Scripts

| Lệnh                                          | Mô tả                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run dev`                                 | Chạy client + server song song                                                          |
| `npm run build`                               | Build production cả client + server                                                     |
| `npm run typecheck`                           | TypeScript typecheck toàn bộ                                                            |
| `npm run lint`                                | ESLint client + server                                                                  |
| `npm run test`                                | Unit + integration tests                                                                |
| `npm run test:queue-drill`                    | Drill queue trên Redis DB 15 cô lập (cần env guard; xem test report)                    |
| `npm run test:e2e`                            | Playwright responsive/browser suite; cần production build đang chạy và biến E2E phù hợp |
| `npm run seed`                                | Seed lại dữ liệu demo                                                                   |
| `npm -w @may-cafe/server run seed:benchmark`  | Reset database benchmark riêng và dựng lại index                                        |
| `npm -w @may-cafe/server run check:benchmark` | Kiểm tra bất biến dữ liệu sau load test                                                 |
| `npm run db:up` / `db:down`                   | Khởi/dừng MongoDB                                                                       |
| `npm run db:migrate` / `db:migrate:prod`      | Migration từ source / artifact production                                               |

## Production build local bằng container

Đặt cấu hình production-local trong `.env` với hai JWT secret khác nhau, mỗi secret tối thiểu 32 ký tự, sau đó chạy (giữ nguyên secret nếu đang có dữ liệu/phiên đăng nhập):

```bash
docker compose -f compose.production.yaml up -d --build
```

Production-local được tách thành ba portal qua cùng Nginx: Guest `http://localhost:8080`, Staff `http://localhost:8081`, Admin `http://localhost:8082`. Guest đi vào pool `server-guest-a/b`; Staff và Admin đi vào pool ưu tiên `server-internal-a/b`. Mỗi portal dùng API/Socket.IO cùng origin và Nginx chặn route/API gọi chéo vai trò; backend vẫn kiểm tra JWT/role. Migration one-shot hoàn tất trước API; scheduler/outbox, realtime và report chạy bằng ba worker role có heartbeat. Menu công khai được cache ngắn hạn trong Redis và invalidation qua outbox. Compose dùng project riêng `maycafe-production` để không va chạm stack dev. Xem resource limit, health check, backup và rollback tại `docs/deployment.md`; xem số tải baseline tại `docs/performance-report.md`. Chưa deploy cloud/HTTPS thật.

## Cấu trúc thư mục

```
.
├── client/                 # Vite + React
├── server/                 # Express + Mongoose
├── packages/contracts/     # Zod schema + DTO dùng chung
├── docs/                   # tài liệu dự án
├── scripts/load/           # k6 benchmark scripts
├── scripts/mongo-init.js   # replica set bootstrap
├── compose.yaml            # MongoDB replica set
└── .env.example
```

Xem chi tiết tại `docs/architecture.md`, `docs/api/openapi.yaml`, `docs/ai-design.md`.

## Bảo mật & vận hành

- Mật khẩu hash bằng bcrypt.
- Access token ngắn hạn (memory), refresh token xoay được, lưu cookie HttpOnly.
- CSRF guard cho mutation của guest theo Origin/Referer.
- Ownership kiểm tra ở service: guest không đọc/huỷ đơn của thiết bị khác.
- Idempotency key bắt buộc khi tạo đơn và thanh toán.
- Shared Redis rate limit cho login, mutation guest, join, gọi món theo bàn, yêu cầu phục vụ, menu search và AI; Nginx có thêm burst/connection limit cho cổng Guest.
- Structured logging với request ID.
- Raw `/metrics` chỉ ở private backend network; trang `/admin/operations` có phân quyền. Xem [docs/observability.md](docs/observability.md).
- Cảnh báo bất thường chỉ ADMIN truy cập; xác nhận/đóng có audit. Xem [docs/anomaly-detection.md](docs/anomaly-detection.md).

## Hạn chế đã biết

- Tìm kiếm menu P4A hiện dùng pipeline xác định (`mode: fallback`), không gọi LLM và không cần API key. AI Barista là luồng gợi ý riêng; key đã cung cấp bị provider trả 401 trong smoke test nên live AI chưa được xác nhận.
- Thanh toán chỉ hỗ trợ "xác nhận tại quầy" trong P0.
- QR động cần màn hình tại bàn có mạng. Chưa kiểm thử quét camera trên điện thoại hoặc truy cập 4G thực tế; 4G cần portal khách có public URL. QR không xác minh khách còn tại quán, nhân viên cần đóng phiên khi khách rời bàn.
- Menu đạt cao nhất 90 RPS theo ngưỡng đã chốt trên Docker Desktop local; 600–700 RPS không đạt. Đây không phải cam kết năng lực cloud.
