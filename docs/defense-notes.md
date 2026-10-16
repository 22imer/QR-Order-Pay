# Defense notes — câu hỏi thường gặp

## 1. Tại sao QR tĩnh mà vẫn "an toàn"?

- QR chỉ chứa token trỏ tới bàn, không phải JWT hay quyền.
- QR hợp lệ cho phép khách tự tạo `TableSession.status = OPEN`; thao tác idempotent nên nhiều người quét đồng thời vẫn chỉ có một phiên hoạt động cho bàn.
- Nhân viên không phải mở bàn trước, nhưng vẫn kiểm soát các bước checkout, xác nhận đã nhận tiền và đóng phiên.
- Guest session là HttpOnly cookie, có TTL 12h, bị thu hồi khi phiên đóng.
- Rate limit cho join theo IP.
- Giới hạn đã biết: người không ngồi tại bàn có thể chụp QR. Bản P2 có thể thêm mã ngắn hiển thị tại bàn (mã staff đọc cho khách) hoặc xoay token định kỳ.

## 2. Làm sao đảm bảo guest không xem/huỷ đơn của guest khác cùng bàn?

- Mỗi request gắn `participantId` từ cookie `mc_guest` (HttpOnly). Mỗi thiết bị sinh `participantId` riêng khi join.
- Mọi query lấy đơn theo `participantId` (service `orderService.getOrderForGuest` kiểm tra `order.participantId === participantId`).
- Test "guest khác cùng bàn không huỷ được" đã chạy trong integration test.

## 3. Idempotency hoạt động thế nào?

- Client phải gửi header `Idempotency-Key` (≥8 ký tự) cho `POST /orders` và `POST /staff/table-sessions/:id/payments`.
- Server lưu `(tableSessionId, idempotencyKey)` unique kèm `requestHash` (sha256 của payload).
- Replay cùng key + cùng payload: trả lại đơn cũ (`created=false`, status 200).
- Replay cùng key + khác payload: trả 409 `IDEMPOTENCY_CONFLICT`.
- Trong DB có unique index trên `(tableSessionId, idempotencyKey)` để đảm bảo atomicity ở mức DB.

## 4. Hai nhân viên cùng chuyển trạng thái đơn?

- `transitionStatus` filter theo `version` và `status` hiện tại; `$inc version` khi update.
- Request thứ hai có `expectedVersion` không khớp → không update được → 409.
- Test: gọi hai PATCH song song, chỉ một trả 200; cái còn lại 409.

## 5. Tại sao snapshot giá/tên vào order items?

- Sửa menu (đổi giá, đổi tên, archive món) không được phép làm thay đổi hóa đơn cũ.
- Mỗi item order có `nameSnapshot`, `variantNameSnapshot`, `unitPrice`, `lineTotal` cố định tại thời điểm đặt.
- Sửa menu chỉ ảnh hưởng đơn mới.

## 6. AI có tạo đơn/huỷ đơn được không?

- Không. Controller `/ai/recommendations` chỉ trả recommendations, không gọi `placeOrder`.
- Bất kỳ đề xuất nào của AI đều phải được khách bấm "Thêm vào giỏ" trên UI, mới gọi `POST /orders` với idempotency key + ownership.
- Output LLM qua structural hook/schema rồi service chỉ giữ ID/variant hợp lệ từ MongoDB; backend tự xác minh giá, evidence và constraints. Output không hợp lệ hoặc không còn món hợp lệ thì fallback; prompt instruction không phải security boundary.

## 7. CORS có chống CSRF được không?

- Không. Hệ thống dùng `guestCsrfGuard` cho mọi mutation của guest:
  - Nếu có `Origin` header → so sánh với `config.serverOrigin`.
  - Nếu không có `Origin`, đọc `Referer` và so sánh host.
  - Nếu không khớp → 403 `FORBIDDEN`.
- Cookie HttpOnly + SameSite=Lax chống đa phần CSRF; nhưng vẫn thêm CSRF guard vì `SameSite=Lax` không bảo vệ form GET top-level navigation.

## 8. Realtime có secure không?

- `socket.io` handshake có middleware xác thực (`socket.handshake.auth.accessToken` cho Staff/Admin, `auth.guestToken` cho Guest).
- Guest token được hash và đối chiếu với `GuestSession` còn hiệu lực.
- Khi phiên đóng, server gọi `guestSessionRepository.revokeByTableSession` → guest token cũ không join được lại.
- Staff/Admin join room `staff`; Guest join room `session:{tableSessionId}` và `guest:{tableSessionId}:{participantId}` (riêng theo thiết bị).

## 9. Tại sao backend có lớp Service/Repository riêng?

- Tách logic nghiệp vụ khỏi HTTP (controller) và DB (repository).
- Service chỉ nhận repository interface → unit test không cần Mongo thật.
- Repository chỉ biết Mongoose; controller không gọi Mongoose trực tiếp.
- UnitOfWork đi qua `mongoose.startSession()` để chuyển session xuống repository → test dễ mock.

## 10. Phụ thuộc nào có thể thay thế?

- AI không có adapter cho mọi nhà cung cấp: `HttpAIProvider` chỉ gọi native Chat Completions (`/chat/completions`) với Bearer auth và `response_format: { type: 'json_object' }`. Chỉ provider/model hỗ trợ đủ contract này mới dùng được; không khẳng định Azure OpenAI hay Ollama tương thích vô điều kiện.
- Dùng `AI_BASE_URL`, `AI_MODEL` và `AI_API_KEY` để chọn endpoint, raw model ID và credential. Zen `space-bunny-free` không có tiền tố `opencode/`; smoke Chat Completions/JSON thật với model ID này đã đạt ngày 06/10/2026. Kết quả không bảo đảm mọi model hoặc mọi credential Zen đều đáp ứng contract.
- `AI_MODE` điều khiển Barista; `ANOMALY_AI_MODE` độc lập và mặc định `fallback`. Nếu một trong hai mode là `live`, startup cần model và key; lỗi provider khi chạy Barista chuyển fallback. Dev config ở `server/.env` (không phải root `.env`), production dùng `.env.production`; thay env phải restart/recreate API/worker.
- Smoke command dưới đây cần DB demo đã seed và credential/hạn mức provider; trên lượt thành công gửi ba request live (một/case), dừng ở case lỗi, chỉ kiểm tra Barista và không gọi anomaly:

  ```bash
  npm run build:contracts
  npm -w @may-cafe/server exec -- tsx scripts/ai-live-smoke.ts
  ```

- Smoke Zen thật đã có kết quả ngày 06/10/2026: ba case trước chuyên hoá và một case kết hợp sau chuyên hoá trả `llm`; một case sau chuyên hoá timeout và fallback. Chưa đánh giá chất lượng tổng quát hoặc skill-vs-baseline. HTTP 401 ngày 22/09/2026 là kết quả lịch sử; xem [ai-evaluation.md](ai-evaluation.md).
- MongoDB: có thể đổi sang PostgreSQL bằng cách viết lại repository (interface đã độc lập với Mongoose).
- Realtime: thay Socket.IO bằng SSE/WS nếu cần.

## 11. Bạn có dùng Next.js không? Tại sao chọn React SPA + Express?

- Theo yêu cầu, dùng React SPA + Express API để backend kiểm soát hoàn toàn (auth, RBAC, idempotency, transactions).
- Next.js gộp frontend/backend dễ bị "rò rỉ" secret nếu không cẩn thận; tách rời giúp phân quyền rõ ràng hơn.
- Vite cho client nhanh và dễ proxy tới Express khi dev.

## 12. Test concurrency có đảm bảo đúng?

- `transitionStatus` dùng `findOneAndUpdate({ _id, status: from, version: expected }, { $inc: version, ... })`.
- MongoDB đảm bảo atomicity của một document update.
- Test "hai staff cùng chuyển" có thể được viết thêm trong P1 (hiện đã có test idempotency, transaction rollback).

## 13. Tại sao không lưu token trong localStorage?

- Lưu access token trong memory (Zustand), không persist.
- Refresh token trong cookie HttpOnly, `Secure` khi deploy HTTPS, `SameSite=Lax`.
- Khi refresh, server xoay token cũ → thu hồi token cũ nếu bị đánh cắp.

## 14. Điểm nào chưa làm?

- Vector DB / RAG cho AI (P2) — không cần với menu ~24 món, rule-based đủ tốt.
- Thanh toán online (P2) — chỉ "xác nhận tại quầy".
- PWA offline (P2).
- Ảnh món dùng Unsplash URL, chưa upload asset riêng.
