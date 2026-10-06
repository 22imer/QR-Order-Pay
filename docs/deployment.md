# Triển khai — Mây Café

## Production build local qua reverse proxy

Cấu hình `compose.production.yaml` chạy các service dài hạn và một migration job:

- `web`: Nginx phục vụ cùng một React production build qua ba portal tách biệt: Guest `8080`, Staff `8081`, Admin `8082`; mỗi cổng chỉ proxy nhóm API đúng vai trò.
- `server-guest-a`, `server-guest-b`: pool Node.js 24 LTS chỉ nhận traffic từ portal Guest qua Nginx.
- `server-internal-a`, `server-internal-b`: pool Node.js 24 LTS riêng cho Staff/Admin, có `cpu_shares` cao gấp ba pool Guest để được ưu tiên khi CPU tranh chấp.
- `worker-scheduler`, `worker-realtime`, `worker-report`: cùng image Node.js nhưng tách scheduler/outbox, thông báo realtime và báo cáo/CSV thành ba process có heartbeat riêng.
- `migrate`: one-shot job chạy migration đã build, phải hoàn tất trước API/worker.
- `mongo`: MongoDB 7 replica set một node; không publish cổng ra host trong cấu hình này.
- `redis`: Redis 7 dùng AOF; làm Socket.IO adapter/emitter, hàng đợi worker có retry/dead-letter, cache menu, rate-limit store và kho aggregate HTTP theo phút; không publish cổng ra host.

Pool Guest và Internal dùng chung MongoDB/Redis nhưng không dùng chung Node process. Compose giới hạn mặc định mỗi API ở `0.75 CPU / 384 MiB`; Guest có `cpu_shares=512`, Internal có `cpu_shares=1536`. Worker và Nginx cũng có giới hạn riêng. Có thể chỉnh các biến `GUEST_API_*`, `INTERNAL_API_*`, `WORKER_*`, `WEB_*` trong môi trường theo cấu hình máy.

Nginx 1.27 dùng Docker DNS resolver động cho bốn upstream. Khi một backend container được recreate và đổi IP, mapping Guest/Internal được cập nhật mà không cần restart Nginx; app-level traffic guard vẫn trả 404 nếu proxy bị cấu hình gọi chéo.

Compose đặt project name cố định `maycafe-production`, tách container/network/volume khỏi `compose.yaml` dùng cho môi trường dev.

Tạo `.env.production` (đã được Git bỏ qua):

```dotenv
PUBLIC_APP_URL=http://localhost:8080
STAFF_APP_URL=http://localhost:8081
ADMIN_APP_URL=http://localhost:8082
COOKIE_SECURE=false
JWT_ACCESS_SECRET=<chuỗi ngẫu nhiên tối thiểu 32 ký tự>
JWT_REFRESH_SECRET=<chuỗi ngẫu nhiên khác, tối thiểu 32 ký tự>
AI_MODE=fallback
ANOMALY_AI_MODE=fallback
AI_PROVIDER=openai
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=
AI_API_KEY=
AI_TIMEOUT_MS=15000
```

Barista và anomaly có công tắc riêng; mặc định cả hai không gọi AI. Muốn bật Barista live, điền `AI_MODE=live`, `AI_MODEL` là raw model ID và `AI_API_KEY` từ provider vào `.env.production`; giữ `ANOMALY_AI_MODE=fallback` nếu không chủ động muốn anomaly inference. Với OpenCode Zen, base URL ví dụ là `https://opencode.ai/zen/v1`, raw ID `space-bunny-free` (không tiền tố `opencode/`); smoke Chat Completions/JSON thật với ID này đã đạt ngày 06/10/2026, không bảo đảm credential/model khác tương thích. Thay provider/model cần cập nhật base URL, model và key phù hợp cùng lúc.

Backend chỉ gửi native Chat Completions tới `${AI_BASE_URL}/chat/completions`, với Bearer auth và `response_format: { type: 'json_object' }`. Chỉ chọn endpoint/model hỗ trợ đủ contract này; không mặc định mọi model Zen, Azure OpenAI hay Ollama đều tương thích. Khi một trong hai mode là `live`, startup yêu cầu key và model tường minh; startup không gọi inference. Lỗi provider khi chạy Barista chuyển sang fallback.

Dev backend đọc `server/.env`, không `.env` ở repo root. Env không hot-reload: restart process dev; sau khi sửa `.env.production`, recreate các container API/worker để nạp cấu hình mới.

`.dockerignore` loại cả `.env`/`.env.*` trong các thư mục con (gồm `server/.env`) khỏi build context; chỉ giữ template `.env.example`. Credential được inject lúc chạy, không copy vào image.

Khởi động và kiểm tra:

```bash
docker compose -f compose.production.yaml --env-file .env.production up -d --build
docker compose -f compose.production.yaml ps
curl http://localhost:8080/healthz
curl http://localhost:8080/api/v1/health
curl http://localhost:8081/healthz
curl http://localhost:8082/healthz
```

Các portal local:

- Guest/QR: `http://localhost:8080`
- Staff/KDS: `http://localhost:8081`
- Admin: `http://localhost:8082`

Nginx trả `404` nếu gọi Staff/Admin API từ cổng Guest hoặc gọi chéo API giữa hai portal nội bộ. Backend vẫn kiểm tra JWT và role; tách cổng chỉ là thêm một lớp cô lập, không thay thế phân quyền. Refresh cookie dùng tên riêng theo portal để Staff và Admin có thể đăng nhập đồng thời trên cùng máy.

Traffic Guest có hai lớp chống spam: Nginx giới hạn burst/connection theo guest cookie (fallback theo IP trước khi có cookie), còn Express + Redis giới hạn join theo token bàn, gọi món theo `tableSessionId`, và yêu cầu phục vụ theo bàn. Mặc định: join `20/phút`, gọi món `12/phút`, yêu cầu phục vụ `6/phút`; tất cả có thể chỉnh bằng biến `RATE_LIMIT_GUEST_*`.

Menu/sản phẩm công khai được cache Redis mặc định 60 giây. Mọi thay đổi product/category/topping từ Admin/Staff ghi outbox; realtime consumer tăng cache generation, còn TTL 60 giây chặn stale vô hạn nếu worker gián đoạn. Nếu Redis lỗi, menu vẫn đọc trực tiếp MongoDB; mutation được bảo vệ không tự fail-open.

Dashboard Admin dùng hàng đợi worker qua `POST /api/v1/admin/reports/overview/jobs` và poll `GET /api/v1/admin/reports/jobs/:id`. Cả JSON và CSV đều được tạo ngoài API process, kết quả giữ mặc định 15 phút sau khi terminal. Thông báo realtime dùng worker riêng qua Socket.IO Redis emitter. Job có owner lease, retry/backoff, reclaim khi worker chết và dead-letter; Admin operations xem/replay job/outbox lỗi có audit.

Không chạy `npm run seed` tự động trong image. Nếu cần dữ liệu demo, thực hiện có chủ ý sau khi kiểm tra đúng database; seed sẽ thay dữ liệu hiện có.

## Smoke live AI Barista (chỉ trên database demo)

Chỉ chạy khi MongoDB đang trỏ đúng database demo đã migrate/seed có chủ ý, có candidate cho cả ba ca, `AI_MODE=live`, cùng model/provider và credential hợp lệ có hạn mức cho phép. Nếu cả ba case thành công thì có đúng ba request Chat Completions (một request/case); dừng ở lỗi/case đầu tiên không đạt. Không gọi anomaly. Không chạy trên production hoặc database rỗng; seed thay dữ liệu hiện có.

```bash
npm run build:contracts
npm -w @may-cafe/server exec -- tsx scripts/ai-live-smoke.ts
```

Sau khi đổi biến AI trong `.env.production`, recreate API/worker containers trước khi smoke; env không được hot-reload. Smoke provider thật đã có biên bản giới hạn ngày 06/10/2026, gồm kết quả `llm` và timeout/fallback sau chuyên hoá — xem [ai-evaluation.md](ai-evaluation.md). Deployment của bạn vẫn cần smoke riêng với credential/model/candidate hợp lệ.


## Health và shutdown

- Public `GET /healthz` là liveness của Nginx/web. Backend có `/healthz` riêng trong private network.
- Backend `GET /readyz` chỉ được gọi trong private network/healthcheck Compose; Nginx không proxy route này. Nó ping MongoDB và Redis với timeout ngắn. Mongo lỗi trả 503; Redis lỗi trả 200 trạng thái `degraded` để menu/read còn phục vụ, trong khi mutation có limiter không tự nới bảo vệ. AI lỗi không làm service mất readiness.
- `SHUTDOWN_TIMEOUT_MS`: thời gian chờ request đang chạy trước khi đóng cưỡng bức connection còn lại.
- `TRUST_PROXY_HOPS=1` chỉ dùng khi backend nằm đúng một hop sau Nginx. Chạy backend trực tiếp phải dùng `0`.

## Metrics và vận hành

- Prometheus scrape `GET /metrics` trực tiếp từ bốn service `server-guest-*`/`server-internal-*` trong private network. Nginx không proxy endpoint này.
- Admin xem số liệu vận hành tại `/admin/operations`; API `/api/v1/admin/operations/summary` bắt buộc vai trò `ADMIN`.
- Có thể đặt `INSTANCE_ID`; Compose gán `server-guest-a/b`, `server-internal-a/b`, `worker-scheduler-1`, `worker-realtime-1`, `worker-report-1` để log/metric phân biệt rõ. Worker healthcheck đọc heartbeat TTL trong Redis. Health API trả thêm `trafficClass=guest|internal` để kiểm tra routing.
- Quy tắc tổng hợp, định nghĩa metric và cách tránh cộng trùng số liệu database nằm tại [observability.md](observability.md).

## HTTPS/cloud

Khi đặt sau load balancer hoặc reverse proxy HTTPS:

1. Đặt `PUBLIC_APP_URL=https://order.<domain>`, `STAFF_APP_URL=https://staff.<domain>`, `ADMIN_APP_URL=https://admin.<domain>` và `COOKIE_SECURE=true`.
2. Giữ frontend, API và Socket.IO cùng origin; proxy phải hỗ trợ WebSocket upgrade.
3. Không public MongoDB; dùng network riêng và authentication phù hợp với nền tảng.
4. Chỉ đặt `TRUST_PROXY_HOPS` bằng số proxy thực tế, không tin tùy ý `X-Forwarded-For` từ Internet.
5. Thay hai JWT secret bằng secret manager; không đưa chúng vào image hoặc repository.

Repository hiện mới có cấu hình production local. Chưa có bằng chứng đã triển khai cloud hoặc HTTPS thật.

## Kết quả production-local cập nhật 23/09/2026

- Image server Node.js 24 LTS và web build thành công trên Docker Engine 29.7.2.
- Lượt production-local trước đây đã xác nhận MongoDB, Redis, bốn backend, web và worker hợp nhất. Source hiện tách ba worker và migration gate; Compose config đã PASS, Redis queue/migration được drill cô lập, nhưng toàn stack mới chưa được recreate để smoke lại. Nginx publish `8080-8082`, các dependency/backend chỉ ở mạng nội bộ Compose.
- Frontend, SPA deep-link, REST proxy, readiness và Socket.IO WebSocket đã hoạt động qua cùng origin.
- Luồng seed → QR → order → KDS states → checkout → payment → Bill → receipt đã PASS trên volume riêng.
- SIGTERM đóng backend sạch với exit code 0 trong khoảng 0,5 giây và restart trở lại healthy.
- Baseline topology hai API ngày 22/09: 20 request health chia 10/10 qua A/B; khi dừng A, 20/20 request được B phục vụ. Đây là số lịch sử trước khi tách Guest/Internal, không dùng để khẳng định throughput topology mới.
- Shared Redis limiter đã được kiểm tra ở cả baseline auth và topology mới: burst Guest chỉ trả 200/429; join cùng hash token bàn đạt đúng ngưỡng 20/phút. Redis dừng thì menu đọc fallback MongoDB, còn mutation không silently fail-open.
- Socket.IO Redis adapter đã qua smoke cross-instance; topology mới bổ sung Redis emitter từ worker và queue notification được drain sạch, không có dead-letter sau payload hợp lệ.

Đây là bằng chứng chạy local container, không phải bằng chứng cloud deployment, HTTPS hay high availability.

## Triển khai cloud còn cần từ chủ dự án

Cấu hình hiện đã sẵn để triển khai nhưng chưa tạo tài nguyên cloud. Trước khi thực hiện cần: nhà cung cấp/tài khoản cloud có quyền tạo dịch vụ, khu vực triển khai, ngân sách hoặc giới hạn chi phí, domain và quyền DNS, lựa chọn MongoDB/Redis managed hay tự quản, secret production (JWT mới; không dùng secret local), cùng quyền GitHub repository nếu muốn CD. Chỉ tạo tài nguyên tính phí sau khi chủ dự án chốt nhà cung cấp và ngân sách.

Sau deploy phải bật HTTPS, `COOKIE_SECURE=true`, đặt ba URL portal và `SERVER_ORIGIN` đúng domain, dùng secret manager, private network cho Mongo/Redis, health check sau release và tag image theo commit. Replica set một node trong Compose không chịu được lỗi host và không phải mô hình database HA cho cloud.

## Backup, restore và rollback

- Trước thay đổi schema/index, tạo backup bằng `scripts/db/backup.ps1`, giữ manifest SHA-256 rồi để migration gate chạy trước API/worker.
- Thử restore bằng `scripts/db/restore-test.ps1` trên database kết thúc `_restore_test`; không ghi đè database demo/production. Drill MongoDB 7 ngày 23/09/2026 đã PASS; xem `backup-restore-runbook.md`.
- Image triển khai cần được gắn tag theo commit. Rollback bằng cách chạy lại tag trước đó; thay đổi dữ liệu không tương thích phải có kế hoạch migration ngược riêng.
- Replica set một node chỉ cung cấp transaction, không cung cấp high availability khi máy chủ hỏng.
