# AI Barista OpenAI-compatible — thiết kế cập nhật để review

## Trạng thái

Người dùng đã duyệt triển khai. Source hiện có environment validation, công tắc anomaly độc lập, skill và hooks runtime Barista, deadline/cancellation kết hợp và live-smoke Barista-only. “Agent” là LLM Barista trong backend, không phải coding agent/OpenCode CLI. Kiểm thử, protocol/UI smoke cục bộ, full stack production cô lập và smoke Zen thật ba case có bằng chứng trong [ai-evaluation.md](../../ai-evaluation.md). Smoke thật dùng cấu hình `.env` root inject riêng vào process; không sửa file env hoặc seed/reset database. App dev chưa tự chuyển live. Chưa đo skill-vs-baseline/pressure scenarios; browser dùng Lightpanda theo `AGENTS.md`, chưa xác nhận CSS/layout đầy đủ hoặc checkbox automation.

## Mục tiêu và phạm vi

- AI Barista gọi LLM thật qua API OpenAI-compatible, ví dụ `https://opencode.ai/zen/v1`.
- Endpoint, provider label, model, key và timeout cấu hình bằng environment; `AI_MODEL` là nơi chọn model duy nhất, không khóa cứng model/Zen trong code và không cho client chọn model theo request.
- Giữ giao diện gợi ý một lượt và endpoint `POST /api/v1/ai/recommendations`.
- `AI_MODE=live`: gọi LLM trước; lỗi runtime thì fallback rule-based và trả `mode: 'fallback'` minh bạch.
- Thiếu key hoặc model khi cấu hình live: báo lỗi cấu hình lúc khởi động, không tự biến live thành fallback.
- `ANOMALY_AI_MODE=fallback` mặc định: bật live Barista không tự bật inference cho giải thích anomaly.

Không làm: chat nhiều lượt, lưu hội thoại, streaming, RAG/vector database, agent orchestration/tool calling, hook OpenCode CLI, tự thêm giỏ/đặt đơn/thanh toán, thêm provider SDK, retry hoặc tự chuyển model/provider, thay menu search, thay detector anomaly.

## Hợp đồng cấu hình

| Biến | Giá trị / mặc định | Ý nghĩa |
| --- | --- | --- |
| `AI_MODE` | `live`, `fallback`, `off`; mặc định `fallback` | Chế độ Barista. `off` giữ hành vi hiện có: gợi ý menu, không gọi provider. |
| `ANOMALY_AI_MODE` | `live`, `fallback`, `off`; mặc định `fallback` | Chỉ điều khiển giải thích anomaly. `off` không tắt detector; dùng giải thích xác định. |
| `AI_PROVIDER` | Mặc định `openai` | Nhãn provider cho log, không chọn giao thức theo tên. |
| `AI_BASE_URL` | Mặc định `https://api.openai.com/v1` | Base URL HTTP(S), không gồm `/chat/completions`. Bỏ slash cuối khi gửi request. |
| `AI_MODEL` | Không tự chọn model mặc định trong code/Compose | Bắt buộc, không rỗng sau trim nếu một trong hai chế độ là `live`. |
| `AI_API_KEY` | Rỗng khi không live | Bắt buộc, không rỗng sau trim nếu một trong hai chế độ là `live`. Không gửi ra frontend/log/Git. |
| `AI_TIMEOUT_MS` | `15000`; số nguyên dương | Deadline mỗi lần gọi provider. |

Chỉ hỗ trợ Chat Completions: POST `${AI_BASE_URL}/chat/completions`, Bearer auth, `model`, `messages`, `temperature`, `response_format: { type: 'json_object' }`. Model được chọn phải hỗ trợ contract này. Không thêm `/responses`, `/messages` hoặc JSON-mode downgrade tự động.

Dev source hiện đọc `server/.env` rồi `server/src/.env`, không tự đọc `.env` ở root. Đợt này giữ loader hiện tại; tài liệu hướng dẫn dùng `server/.env`. Production dùng `docker compose --env-file .env.production` và environment injection. Thay env cần restart API/worker; không hot-reload cấu hình.

Chọn model bằng cách sửa duy nhất `AI_MODEL` thành raw model ID được provider hỗ trợ, ví dụ `space-bunny-free`; giữ model ngoài source code. Không thêm dropdown UI, model list hardcoded, auto-discovery lúc startup hoặc model fallback. Có thể đổi `AI_BASE_URL` và key cùng lúc khi chuyển provider; model ID không dùng prefix `opencode/` trong request HTTP này. Startup chỉ kiểm tra cấu hình; quyền model và khả năng JSON-mode phải kiểm chứng bằng smoke thật, không gọi API lúc startup.

## Chế độ và hành vi lỗi

| Barista | Anomaly | Kết quả |
| --- | --- | --- |
| fallback/off | fallback/off | Không gọi AI provider ở cả hai luồng; không cần credential. |
| live | fallback/off | Barista live; anomaly chỉ giải thích xác định. |
| fallback/off | live | Barista không gọi provider; anomaly live bằng credential dùng chung. |
| live | live | Cả hai chủ động gọi cùng endpoint/model/key. |

- Giá trị mode ngoài enum, live thiếu key/model, URL không hợp lệ hoặc timeout không dương: khởi động thất bại với tên biến lỗi, không in giá trị nhạy cảm.
- Timeout, network error, HTTP 401/429/5xx, response envelope sai, JSON/schema sai, hoặc không còn recommendation hợp lệ: Barista fallback theo hành vi hiện có.
- Không có món đáp ứng ràng buộc: trả danh sách rỗng minh bạch; không tự nới ngân sách/caffeine/dairy để cố trả kết quả.
- Không retry. Mỗi yêu cầu gợi ý gọi provider tối đa một lần.
- Giữ response contract `mode: 'llm' | 'fallback'`; không thêm field lý do lỗi/API key/provider response cho client.
- UI hiện đã hiển thị badge AI hoặc Gợi ý theo menu; giữ nguyên.

## Invariants và bảo mật

- Backend sở hữu product/variant ID, availability, giá và evidence từ MongoDB. LLM không có quyền tạo đơn hoặc quyết định giá.
- Tối đa 3 gợi ý, loại ID lạ/trùng, variant hết bán, món vượt ngân sách hoặc không đạt metadata.
- Giữ `verifiedReason()` của backend, không thay bằng lời khẳng định dinh dưỡng do LLM sinh.
- Giữ validation variant/topping trước khi thêm giỏ, guest authentication, CSRF và Redis rate limit hiện có.
- Không gửi cookie, JWT, participant ID, lịch sử đơn hay thông tin thanh toán cho provider.
- Xóa log snippet raw LLM khi schema sai; provider lỗi không log response body. Không log prompt/key/model response nguyên văn.
- Timeout nội bộ phải còn hiệu lực khi caller truyền AbortSignal.

## Skill và response hooks

Skill runtime nằm trong module TypeScript `server/src/ai/baristaSkill.ts`: một system instruction tiếng Việt, trả đúng JSON model-output contract. Đây không phải `SKILL.md` được OpenCode tự load. Chọn TypeScript constant để build hiện có đóng gói được ngay, không thêm file-copy step hoặc đọc Markdown mỗi request.

`server/src/ai/baristaHooks.ts` cung cấp hai hàm đồng bộ, được gọi trực tiếp trong `AIService.llmRecommend()`:

1. `beforeBaristaRequest(context)`: dựng system/user messages từ skill và menu snapshot đã được backend lọc; prompt/menu là dữ liệu JSON trong user message, không được nối vào system instruction.
2. `afterBaristaResponse(raw)`: parse JSON và validate shape bằng Zod, tối đa 3 recommendation; sai shape thì throw lỗi cố định để service fallback, không log raw output.

Model output: `{message, recommendations: [{productId, variantId?, reason}], followUpQuestion?}`. Backend vẫn bổ sung `mode`, tên món, ảnh, giá, evidence và latency. Không yêu cầu LLM sinh frontend DTO hay coi giá/evidence từ LLM là nguồn thật.

Giữ DB/variant/availability/budget/caffeine/dairy validation trong service và validation giỏ hiện có. Skill là hướng dẫn, không phải security boundary; response hook là structural boundary, backend validation là business boundary. Không dựng event bus/plugin registry, không hook anomaly vào skill Barista.

Di chuyển prompt/schema/parser cũ sang hai module trên, không giữ bản sao, alias hoặc đường xử lý cũ. Code mẫu và kiểm thử cụ thể ở Task 2 của kế hoạch.

## Kiểm chứng bắt buộc khi triển khai

1. Unit regression: mode sai, live thiếu credential/model, timeout sai; anomaly độc lập với Barista.
2. Transport regression với HTTP server cục bộ: timeout/caller abort, HTTP lỗi, response envelope sai và không lộ body lỗi.
3. MongoDB integration: live output hợp lệ giữ giá/evidence thật; output bịa ID/variant hoặc vi phạm ràng buộc bị loại/fallback an toàn.
4. Live smoke có giới hạn: script hiện hữu chuyển thành Barista-only, phải exit nonzero nếu một ca nhận fallback. Không đánh đồng HTTP 200/fallback với live thành công.
5. Browser smoke: vào phiên bàn, gọi AI, xác nhận badge live/fallback và flow chọn món/validate giỏ vẫn hoạt động.
6. Trước và sau smoke live đối chiếu số request và chính sách hạn mức ở provider; không chạy benchmark hay vòng lặp inference.

## Nguồn và giới hạn bằng chứng

- Code đã đọc: `server/src/config/index.ts`, `server/src/providers/aiProvider.ts`, `server/src/services/aiService.ts`, `server/src/services/anomalyExplanationService.ts`, `server/src/controllers/aiController.ts`, `client/src/features/ai/AISheet.tsx`, `server/scripts/ai-live-smoke.ts`, `compose.production.yaml`.
- [Zen endpoints và privacy](https://opencode.ai/docs/zen/): endpoint phụ thuộc model; không coi mọi model Zen là Chat Completions tương thích.
- [Danh sách model thực tế](https://opencode.ai/zen/v1/models): đã đọc ngày 2026-10-06, có `space-bunny-free`; không hardcode model trong app. Sau khi người dùng bổ sung key và yêu cầu thử, smoke Chat Completions/JSON thật với model ID này đã đạt ba case. Chưa đánh giá tiếng Việt tổng quát hoặc skill-vs-baseline; smoke không xác minh chính sách retention/billing.
- Nếu model ví dụ không qua kiểm chứng, chọn model khác tương thích qua `.env` và chạy lại smoke có kiểm soát; không tự chuyển sang model trả phí.
- Docker WSL và dependencies đã sẵn sàng: `npm ci`, covering tests, quality gates, full stack production cô lập và một lượt smoke Zen thật đã chạy. Pressure/baseline chưa chạy ngoài ba lời gọi được yêu cầu; giới hạn Lightpanda vẫn ghi riêng, không thu hẹp acceptance.
