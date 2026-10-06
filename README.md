# Mây Café — QR Ordering & AI Barista

Trạng thái triển khai và ghi nhớ cho lần làm việc tiếp theo: [PROJECT_MEMORY.md](PROJECT_MEMORY.md).
Kết quả kiểm chứng mới nhất: [docs/test-report.md](docs/test-report.md).

Một hệ thống MERN (MongoDB + Express + React + Node.js) đặt đồ uống qua QR tại bàn, tích hợp AI Barista tư vấn món. Mục tiêu là bài tập lớn Lập trình Web: chạy trên dữ liệu thật, kiến trúc phân tầng rõ ràng, giao diện chỉn chu, có kiểm thử, OpenAPI và tài liệu bảo vệ.

## Tính năng chính

- Quét QR / nhập mã → vào phiên bàn; bàn trống thì khách tự mở phiên, không cần chờ nhân viên.
- Thực đơn đa danh mục, tùy chỉnh size/đường/đá/topping, ghi chú.
- Tìm kiếm menu bằng câu tiếng Việt có/không dấu, typo nhẹ, ngân sách và ràng buộc caffeine/sữa; kết quả rỗng minh bạch và có bộ lọc sửa tay.
- AI Barista gợi ý tối đa ba món từ menu thật theo sở thích/ngân sách; mặc định dùng fallback, còn live là opt-in qua backend config với key/model tường minh.
- Giỏ hàng theo thiết bị, quote ký trước khi đặt và idempotency khi gửi đơn.
- KDS có tuổi công đoạn/SLA, duyệt yêu cầu hủy; staff có màn hình báo hết món, chuyển bàn và đối soát ca.
- Realtime qua Socket.IO cho cả guest và staff.
- Thanh toán tại quầy với xác nhận của Staff: phiên được chốt thành hóa đơn bất biến (`Bill` snapshot), trả bàn về trạng thái tự do.
- Hóa đơn riêng theo thiết bị và đánh giá sau thanh toán, không cấp lại quyền đặt món.
- Admin tạo ảnh QR để tải PNG/in; khách có thể dán token hoặc liên kết QR để vào bàn.
- Dashboard doanh thu, lịch sử/in lại hóa đơn snapshot, biểu đồ ngày/giờ và top sản phẩm.
- Dashboard vận hành riêng cho ADMIN: dependency, hàng đợi, socket, lỗi HTTP, tài nguyên và thời gian công đoạn.
- Detector bất thường định kỳ cho lỗi/độ trễ/pha chế/hủy đơn, có baseline, “chưa đủ dữ liệu”, bằng chứng, cooldown và giải thích fallback an toàn.
- PWA giữ giao diện và giỏ khi mất mạng, hiển thị trạng thái kết nối; đơn chỉ được gửi khi online.
- Dashboard lọc theo ngày, xuất CSV và in/PDF; thống kê toàn bộ đơn đã thanh toán theo múi giờ Việt Nam.
- Đánh yêu cầu gọi nhân viên và yêu cầu thanh toán.
- Phân quyền ADMIN/STAFF/GUEST kiểm tra cả HTTP và socket.

## Stack

- **Server**: Node.js 24 LTS, Express + Mongoose + TypeScript, JWT, bcryptjs, Socket.IO + Redis adapter, Zod, Pino, Prometheus metrics.
- **Client**: Vite + React + TypeScript, Tailwind, Radix UI, TanStack Query, Zustand, Recharts, Lucide.
- **AI**: native OpenAI-compatible Chat Completions only; the selected provider/model must support Bearer auth and JSON-object mode. Rule-based fallback remains available.
- **Tests**: Vitest + Supertest + Playwright + k6; GitHub Actions chạy quality/integration.

## Cài đặt nhanh

`compose.yaml` khởi MongoDB; Redis cho dev chạy riêng:

```bash
npm ci
npm run db:up          # khởi MongoDB replica set
docker run -d --name maycafe-redis -p 6379:6379 redis:7-alpine
npm run db:wait        # đợi MongoDB sẵn sàng
npm run build:contracts # build shared contracts trước migration/seed
npm run db:migrate     # áp migration/index có lock và checksum
npm run seed           # CHÚ Ý: thay dữ liệu database; chỉ chạy trên DB demo có thể reset
npm run dev            # chạy client + server
```

Server đọc cấu hình dev từ `server/.env`, không từ `.env` ở repo root. AI mặc định dùng fallback; cấu hình bật live và smoke nằm trong [docs/ai-design.md](docs/ai-design.md).

- Server: `http://localhost:4000`
- Client: `http://localhost:5173`

## Tài khoản demo (mật khẩu `MayCafe@2025`)

- `admin@maycafe.vn` (ADMIN)
- `staff.a@maycafe.vn` (STAFF)
- `staff.b@maycafe.vn` (STAFF)

Khi seed, mỗi bàn sẽ in ra một token QR. Dùng token đó tại `/t/<token>` để vào phiên.

## Luồng khách: quét QR → đặt món

1. Khách quét QR (hoặc dán token) → `POST /api/v1/table-sessions/join`.
2. Nếu bàn **chưa có phiên**, server tự mở phiên mới (`source: 'GUEST'`, có audit log) và trả `created: true`, kèm `guestSessionId` / `participantId` để đặt món. Thao tác này **idempotent** và an toàn khi nhiều người quét cùng lúc: hai request đồng thời chỉ tạo đúng một phiên, cả hai nhận cùng `tableSessionId`.
3. Nếu bàn **đang có phiên**, khách được đưa vào đúng phiên đó (`created: false`) — không tạo phiên trùng.
4. Khách đặt món như bình thường; giỏ hàng gắn theo phiên.

Khi Staff thu đủ tiền, phiên được đóng và **chốt thành `Bill` bất biến** (snapshot đơn/giá/topping/tên món và các khoản đã thu) trong cùng transaction. Bàn lập tức trở lại trạng thái tự do: khách quét lại QR sẽ có phiên mới và đặt được món ngay, không cần nhân viên can thiệp. Bản ghi `Bill` chỉ ghi một lần (unique theo `tableSessionId`), không có API sửa/xóa.

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

Tạo `.env.production` với hai JWT secret khác nhau, mỗi secret tối thiểu 32 ký tự, sau đó chạy:

```bash
docker compose -f compose.production.yaml --env-file .env.production up -d --build
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

- P4A menu search là pipeline xác định, không gọi LLM. AI Barista dùng native OpenAI-compatible Chat Completions; smoke Zen thật ngày 06/10/2026 đã đạt ba case trước chuyên hoá và một case kết hợp sau chuyên hoá. Một case mới timeout 15 giây và fallback an toàn; chưa benchmark chất lượng/chi phí hoặc skill-vs-baseline. HTTP 401 ngày 22/09/2026 là bằng chứng lịch sử. Xem [docs/ai-evaluation.md](docs/ai-evaluation.md).
- Thanh toán chỉ hỗ trợ "xác nhận tại quầy" trong P0.
- QR là tĩnh; admin đổi token thủ công và tải được ảnh QR, chưa có xoay theo lịch. Camera/in QR thật được để kiểm thử sau.
- Menu đạt cao nhất 90 RPS theo ngưỡng đã chốt trên Docker Desktop local; 600–700 RPS không đạt. Đây không phải cam kết năng lực cloud.
