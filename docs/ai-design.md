# AI Barista — thiết kế & vận hành

## Mục tiêu

Khách nhập câu tiếng Việt tự nhiên ("mình thích vị chua nhẹ, không cà phê, dưới 50 nghìn"), AI có thể trả tối đa ba món đang bán có ảnh, giá và lý do. Khi LLM không khả dụng, hệ thống dùng fallback rule-based từ menu thật, ghi rõ `mode: "fallback"` để UI/audit biết.

## Kiến trúc

```
Client  ─► POST /api/v1/ai/recommendations
              │
              ▼
        aiController  (rate limit 30 / 5 phút / guest hoặc IP)
              │
              ▼
        aiService.recommend(input)
              │
              ├── AI_MODE=off/fallback       → rule-based menu fallback
              └── AI_MODE=live               → Chat Completions provider
                                                   │
                                                   ▼
                                      structural output hook
                                                   │
                                                   ▼
        Validate product/variant/availability/price/budget/caffeine/dairy
              │
              ▼
        Trả response có cấu trúc, mode='llm' hoặc fallback
```

`AI_MODE` chỉ điều khiển Barista. `ANOMALY_AI_MODE` điều khiển riêng phần giải thích anomaly và mặc định `fallback`; bật Barista live không bật inference anomaly.

## Provider

`HttpAIProvider` POST `${AI_BASE_URL}/chat/completions` (mặc định `https://api.openai.com/v1/chat/completions`), dùng Bearer authentication, `model`, `messages`, `temperature` và `response_format: { type: 'json_object' }`. Chỉ chọn endpoint/model thực sự hỗ trợ đủ hợp đồng Chat Completions này, gồm JSON-object mode; tên provider không tự chọn giao thức hoặc adapter.

Timeout `AI_TIMEOUT_MS` (mặc định 15 giây). Lỗi runtime như timeout, network, HTTP hoặc output không hợp lệ → Barista fallback minh bạch; không retry.

## P4A — tìm kiếm menu bằng tiếng Việt

Tìm kiếm chính trên trang menu dùng một pipeline xác định, tách biệt với AI Barista:

```
query (tối đa 200 ký tự)
  → bỏ dấu + sửa một số lỗi gõ trong từ điển giới hạn
  → MenuSearchIntent đã kiểm tra bằng Zod
  → điều kiện cứng: nhóm loại trừ, budget, caffeine, dairy, availability
  → xếp hạng: từ khóa, nhóm, khẩu vị, ít ngọt, featured, giá
  → tối đa 12 món từ database
```

- `dưới 40 nghìn` là `< 40.000đ`; `không quá`/`tối đa` là `<= 40.000đ`. Budget luôn áp dụng cho một món với size khả dụng rẻ nhất.
- `không cà phê` chỉ loại nhóm cà phê. Chỉ `không caffeine`, `không cafein` hoặc `decaf` mới bật ràng buộc caffeine.
- Với `không caffeine`/`không sữa`, metadata phải xác nhận chính xác `false`; dữ liệu thiếu không được xem là an toàn.
- Món ngừng bán, lưu trữ hoặc không còn size hợp lệ bị loại trước khi xếp hạng. Không có kết quả thì trả rỗng và nói rõ, không tự chèn món gần đúng.
- Client debounce 350 ms, truyền `AbortSignal` để hủy request cũ và cho phép người dùng sửa trực tiếp budget/caffeine/dairy.

P4A menu search luôn chạy pipeline xác định, không gọi LLM và không cần API key. AI Barista là luồng riêng, có thể bật live qua `AI_MODE=live`; backend vẫn kiểm soát menu, giá và ràng buộc trong mọi chế độ.

## Skill và hooks

`server/src/ai/baristaSkill.ts` là nguồn system instruction duy nhất cho Barista; đây là TypeScript runtime của backend, không phải coding-agent/OpenCode CLI skill. `server/src/ai/baristaHooks.ts` dựng system/user messages trước request và parse/validate cấu trúc JSON sau response. Prompt/menu được gửi như dữ liệu user; không nối vào system instruction.

Skill có năm nhóm chuyên hoá, được đóng gói trong cùng system instruction và áp dụng theo thứ tự:

1. **Đọc nhu cầu:** dùng preferences/budget đã chuẩn hóa; phân biệt tránh cà phê với không caffeine.
2. **Lọc điều kiện bắt buộc:** giữ caffeine/sữa/budget; metadata thiếu không đủ để xác nhận, không nới điều kiện khi hết candidate.
3. **Xếp hạng khẩu vị:** dùng flavorProfile/tags/mô tả thật; ít ngọt không đồng nghĩa không đường, không bịa thành phần hoặc lợi ích sức khỏe.
4. **Chọn size theo ngân sách:** budget cho một món, ID variant từ snapshot; ưu tiên size tiết kiệm khi khách yêu cầu.
5. **Giải thích/hỏi lại:** lý do cụ thể, tối đa một câu hỏi có ích; dị ứng cần xác nhận với nhân viên, không có cam kết y tế.

Không thêm loader, registry, tool calling hoặc hook coding-agent. Năm nhóm dùng chung contract response và hai hooks hiện hữu; backend vẫn dựng lý do/evidence đã kiểm chứng.

Đây là ba lớp có vai trò riêng:

1. **Instruction:** yêu cầu model trả JSON và chọn món từ menu snapshot.
2. **Structural hook:** kiểm tra shape và giới hạn tối đa ba recommendations; output sai đưa vào fallback.
3. **Business validation:** service đối chiếu ID/variant/availability/giá/ngân sách/caffeine/dairy với dữ liệu MongoDB, rồi tạo evidence và lý do đã xác minh.

Skill chỉ là hướng dẫn, không bảo đảm model tuân thủ hoặc chống mọi prompt injection. Model không quyết định ID hợp lệ, giá, evidence, đơn hàng hay thanh toán.

## Output và kiểm chứng nghiệp vụ

Model chỉ trả `{message, recommendations: [{productId, variantId?, reason}], followUpQuestion?}`. Hook kiểm tra JSON/schema và tối đa ba gợi ý; output sai cấu trúc khiến service fallback.

Sau đó backend:

- Chỉ nhận ID có trong candidate menu từ MongoDB; loại ID trùng, variant không hợp lệ, size không được phép, món hết bán hoặc lưu trữ.
- Tính giá từ DB, loại món vượt ngân sách và áp dụng caffeine/dairy theo metadata; metadata thiếu không đạt điều kiện yêu cầu.
- Tạo evidence và lý do đã xác minh từ DB, không dùng giá/evidence hoặc khẳng định dinh dưỡng do LLM sinh.
- Nếu không còn recommendation hợp lệ thì response dùng `mode: 'fallback'`; không tự nới ràng buộc.

## Fallback

Rule-based dựa trên:

- `flavorProfile` chứa "chua", "đắng", "ngọt", "béo".
- `tags` chứa "no-caffeine", "no-dairy", "low-sugar", "fruit".
- Từ khoá trong prompt (chua/đắng/ngọt/trái cây) cộng điểm.
- `isFeatured` cộng điểm.
- Sort theo `score desc, basePrice asc`. Lấy 3 món đầu.

Chọn tối đa ba món còn bán đáp ứng các điều kiện; nếu không có candidate phù hợp thì trả danh sách rỗng, không tự nới ràng buộc.

## Bảo mật

- API key chỉ ở backend environment; không log key, prompt hoặc raw model output.
- Rate limit theo `participantId` (nếu có) hoặc IP; giới hạn prompt ≤ 500 ký tự.
- Validate request với Zod; recommendation được kiểm tra lại từ MongoDB.

## Cấu hình

Mặc định `AI_MODE=fallback` và `ANOMALY_AI_MODE=fallback`; không cần key, không gọi provider. Dev backend đọc `server/.env` (không đọc `.env` ở repo root); tạo/sửa file đó nếu muốn bật live. Production dùng `.env.production` được inject qua Compose. Thay env cần restart API/worker; cấu hình không hot-reload.

Khi chủ động bật Barista live, điền cấu hình riêng của provider trong `server/.env`:

```dotenv
AI_MODE=live
ANOMALY_AI_MODE=fallback
AI_PROVIDER=opencode-zen
AI_BASE_URL=https://opencode.ai/zen/v1
AI_MODEL=space-bunny-free
AI_API_KEY=<provider-issued-key>
AI_TIMEOUT_MS=15000
```

`space-bunny-free` là ví dụ raw model ID được liệt kê cho Zen, không có tiền tố `opencode/`; model list không chứng minh quyền truy cập hoặc JSON-mode hoạt động. Chọn model bằng `AI_MODEL`, không phải UI/request. Khi đổi provider, đổi base URL/model/key cho một model đáp ứng đúng hợp đồng Chat Completions + Bearer + JSON-object mode. Không có cam kết mọi model Zen hoặc mọi cấu hình Azure/Ollama tương thích.

Nếu `AI_MODE` hoặc `ANOMALY_AI_MODE` là `live`, startup yêu cầu `AI_API_KEY` và `AI_MODEL` tường minh; mode không hợp lệ, URL không phải HTTP(S) hợp lệ hoặc timeout không dương cũng làm startup thất bại, không echo giá trị nhạy cảm. Startup không gọi inference; lỗi runtime như model không được cấp quyền sẽ dùng fallback. Smoke live chỉ trên DB demo đã seed, sau khi chủ động cấu hình credential/hạn mức và build contracts:

```bash
npm run build:contracts
npm -w @may-cafe/server exec -- tsx scripts/ai-live-smoke.ts
```

Nếu cả ba case thành công, lệnh gửi đúng một request live cho mỗi case; dừng và thoát khác 0 khi gặp lỗi/case không đạt. Không gọi anomaly. Smoke Zen thật với model yêu cầu `space-bunny-free` đã đạt ba case ngày 06/10/2026; đây không phải đánh giá chất lượng tổng quát hoặc skill-vs-baseline.

Xem `docs/ai-evaluation.md` để biết ma trận P4A, bằng chứng 401 lịch sử, smoke Zen thật và các giới hạn kiểm chứng còn lại.
