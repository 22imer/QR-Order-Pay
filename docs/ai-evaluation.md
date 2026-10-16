# Đánh giá tìm kiếm thông minh và AI Barista

Cập nhật ngày 06/10/2026; giữ riêng bằng chứng lịch sử của từng lượt kiểm tra. Hai luồng `menu/search` và `ai/recommendations` được đánh giá riêng để không nhập nhằng fallback với kết quả LLM thật.

## P4A — tìm kiếm menu xác định

`POST /api/v1/menu/search` hiện chạy ở `mode: "fallback"`. Backend đọc menu thật từ MongoDB, chuẩn hóa câu tiếng Việt, áp dụng điều kiện cứng rồi mới xếp hạng. Luồng này không cần API key, không giả lập là AI và không dùng giá do client cung cấp.

Giá dùng để lọc là giá thấp nhất của size còn bán cho **một món**. Tổng tiền khi đặt món vẫn được backend tính lại độc lập.

### Ma trận đánh giá

| Nhóm                  | Ví dụ                                     | Bất biến cần giữ                                                       |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| Có dấu/không dấu      | `cà phê`, `ca phe`, `caphe`               | Cùng nhận ra nhóm cà phê                                               |
| Lỗi gõ nhẹ            | `caphee`, `traa daoo`                     | Sửa trong từ điển giới hạn, không fuzzy toàn câu                       |
| Nhóm/khẩu vị          | `cà phê đậm`, `trà trái cây ít ngọt`      | Đúng nhóm; khẩu vị chỉ dùng để xếp hạng                                |
| Không caffeine        | `không caffeine`, `khong cafein`, `decaf` | Chỉ nhận món có metadata `caffeine=false`; thiếu metadata cũng bị loại |
| Không sữa             | `không sữa`                               | Chỉ nhận món có metadata `dairy=false`; thiếu metadata cũng bị loại    |
| Loại nhóm             | `không cà phê, trà đào`                   | Loại nhóm cà phê; **không** suy diễn thành không caffeine              |
| Ngân sách nghiêm ngặt | `dưới 40 nghìn`                           | Giá mỗi món phải `< 40.000đ`                                           |
| Ngân sách bao gồm     | `không quá 40 nghìn`, `tối đa 40k`        | Giá mỗi món được `<= 40.000đ`                                          |
| Định dạng giá         | `40k`, `40.000đ`, `39,5k`                 | Chuẩn hóa đúng VND                                                     |
| Tình trạng bán        | Món/size ngừng bán                        | Không xuất hiện trong kết quả                                          |
| Không có kết quả      | Từ khóa không khớp                        | Trả danh sách rỗng và thông báo trung thực; không chèn món rẻ nhất     |
| Bộ lọc sửa tay        | Budget/caffeine/dairy trên UI             | Giá trị người dùng sửa ghi đè phần tương ứng đã suy ra                 |

### Kết quả tự động

- Unit search: **25/25 PASS**.
- Top-1 trên 13 truy vấn định trước: **13/13 đúng**.
- 12 ca bất biến/ràng buộc: **12/12 đạt**, không có vi phạm điều kiện cứng.
- Integration kiểm tra endpoint công khai trên MongoDB tạm: câu `ca phe khong sua duoi 40 nghin` chỉ trả món xác nhận `dairy=false`, giá `< 40.000đ`; input rỗng trả 422.

Đây là bộ dữ liệu tổng hợp nhỏ dùng để khóa hồi quy, chưa phải bằng chứng về chất lượng tìm kiếm trên traffic người dùng thật.

### Chế độ live

Tìm kiếm P4A vẫn không gọi LLM; nếu bổ sung sau này, LLM chỉ được phép sinh `MenuSearchIntent`, output phải qua Zod rồi dùng lại đúng hàm lọc/xếp hạng backend hiện tại. Không cho LLM chọn giá, tạo ID sản phẩm hay tự nới điều kiện cứng.

## AI Barista hiện hữu

`POST /api/v1/ai/recommendations` là tính năng gợi ý riêng. Chế độ fallback đã có kiểm thử semantic.

Ngày 22/09/2026 đã thử smoke test live có giới hạn bằng key đọc tạm thời từ `apikey.txt`: ba ca recommendation và một ca giải thích anomaly. Provider trả HTTP 401 cho cả bốn lần; ứng dụng đều chuyển sang fallback an toàn và không làm gián đoạn request chính. Vì không có response live hợp lệ, **không công bố chất lượng, latency hoặc chi phí LLM**. Đây là kết quả lịch sử, không phải kiểm tra live hiện tại.

Provider logger không ghi response body lỗi vì body của nhà cung cấp có thể lặp lại định danh key đã che một phần. Không copy key vào tài liệu, log hoặc Git; `apikey.txt` đã nằm trong `.gitignore`. Chỉ bật AI live ở môi trường có credential hợp lệ và hạn mức chi phí rõ ràng.

### Trạng thái live hiện tại — 06/10/2026

Script `server/scripts/ai-live-smoke.ts` nay chỉ gọi AI Barista, không gọi anomaly. Yêu cầu `AI_MODE=live` và yêu cầu cả ba ca trả `mode: 'llm'`, từ 1 đến 3 recommendations, giá/evidence khớp, ngân sách đạt và metadata caffeine/sữa đạt khi ca đó yêu cầu. Fallback, cấu hình sai, lỗi hoặc vi phạm constraint làm lệnh thất bại; summary giới hạn ở tên ca, mode, latency, constraint status và product/variant IDs, không in prompt, key hoặc raw output.

Đã chạy smoke Zen thật sau khi người dùng bổ sung credential và yêu cầu chạy thử: **ba case đều `mode=llm`, constraints đạt, exit 0**. Key/endpoint/model ở `.env` root được inject riêng vào process smoke; các file env không bị sửa. Backend dev vẫn đọc `server/.env`, không tự đọc `.env` root, và cấu hình lưu trên đĩa vẫn là fallback. Để áp dụng live cho app dev, cấu hình `server/.env`, chọn raw model ID bằng `AI_MODEL` và restart server process:

```bash
npm run build:contracts
npm -w @may-cafe/server exec -- tsx scripts/ai-live-smoke.ts
```

Nếu cả ba ca đạt, lệnh thực hiện ba request live — mỗi case một lần; lệnh dừng ở case đầu tiên thất bại. Không chạy khi chưa có key/quyền/hạn mức. Xem [ai-design.md](ai-design.md) và [deployment.md](deployment.md) về cấu hình, Compose và restart.

### Smoke Zen thật — 06/10/2026

- Endpoint `https://opencode.ai/zen/v1`, model yêu cầu `space-bunny-free`; chỉ process smoke dùng `AI_MODE=live`, `ANOMALY_AI_MODE=fallback`. Key được truyền bằng process environment, không argv/log/tài liệu.
- Chạy `server/scripts/ai-live-smoke.ts` một lượt: **3 case / 3 lời gọi provider**, không retry, không gọi anomaly; process exit **0**, stderr rỗng.

| Case | Mode | Số gợi ý | Latency service | Constraints |
| --- | --- | --- | --- | --- |
| Budget 45.000đ | `llm` | 3 | 10.721 ms | Giá/evidence khớp, không vượt budget |
| Không caffeine | `llm` | 3 | 4.158 ms | Giá/evidence khớp, caffeine=false |
| Không sữa, budget 60.000đ | `llm` | 3 | 8.006 ms | Giá/evidence khớp, dairy=false, không vượt budget |

- Dùng menu hiện có trong database `maycafe`: 24 món available; đọc kiểm tra trước smoke thấy 13 candidate budget, 12 candidate không caffeine và 8 candidate không sữa/budget. Không seed/reset database hoặc sửa menu.
- Đây là bằng chứng quyền truy cập và Chat Completions/JSON contract hoạt động cho model được yêu cầu trên ba input này. Chưa chạy pressure scenarios hoặc skill-vs-baseline; không khẳng định cải thiện chất lượng, chi phí hay latency đại diện.

### Skill chuyên hoá gợi ý đồ uống — 06/10/2026

- Runtime instruction trong `server/src/ai/baristaSkill.ts` có năm nhóm: đọc nhu cầu, lọc điều kiện bắt buộc, xếp hạng khẩu vị, chọn size theo ngân sách và giải thích/hỏi lại. Giữ nguyên hooks, routes và DTO.
- Output-hook unit: **6 tests PASS**. Server build: **PASS** với heap Node 768 MB; lượt 384 MB trước đó bị heap OOM. LSP probe chưa xác nhận clean vì timeout, không thay bằng kết luận từ cache trống.
- Sau thay skill, lượt budget của live-smoke timeout ở deadline **15 giây**, service fallback và script exit **1**; hai case còn lại không chạy. Không gọi lại cùng case hoặc nới deadline.
- Một request thật khác với cả no-caffeine/no-dairy, vị chua và budget 45.000đ: **mode=llm**, một gợi ý **Trà Vải Hoa Hồng**, giá/evidence **45.000đ**, caffeine/dairy đều false, latency service **11.733 ms**, exit **0**. Đọc lại DB xác nhận flavorProfile `chua`, `hoa`. Tổng lượt kiểm chứng skill mới: **2 lời gọi provider**, không retry/anomaly; chưa có benchmark chứng minh cải thiện so với skill cũ.
- App chạy backend compiled trên 4000 và frontend preview trên 5173, `AI_MODE=live`, `ANOMALY_AI_MODE=fallback`; key lấy từ `.env` root qua process environment, không sửa file env. Lightpanda xác nhận trang `/t` và dialog `/ai`; gọi AI khi chưa vào phiên bàn bị backend từ chối **401**, không bypass guard hoặc tạo/xoay QR.
- Script smoke bổ sung và browser/CDP thử nghiệm đã được dọn; MongoDB và app được giữ chạy để người dùng thử. Không seed/reset hoặc sửa menu/database.


### Kiểm chứng triển khai cục bộ — 06/10/2026

- Config, hooks, transport và anomaly: **40 tests PASS**. Config/anomaly đã có red trước sửa; hồi quy output hơn ba gợi ý cũng đã fail ở `llm` trước cutover và pass sau sửa.
- `orderFlow.test.ts`: **47 tests PASS**, gồm ID bịa/trùng, giá DB, variant sai hoặc vượt budget, availability/archive, metadata thiếu, JSON lỗi, timeout và không có candidate. Hồi quy metadata thiếu đã phát hiện Mongoose hydration tự điền `false`; Barista nay loại hydration default khi áp dụng ràng buộc caffeine/sữa.
- Typecheck workspace, server typecheck sau sửa, lint server/client, module boundaries và production build: **PASS**. Sau khi các lượt chạy song song gây thiếu RAM, verification cuối chạy tuần tự với heap Node giới hạn 768 MB. Sau chỉnh đồng bộ timeout/cancellation trong transport tests, chạy lại riêng provider: **8 tests PASS**, lint server/boundaries và server typecheck **PASS**.
- Provider HTTP loopback dùng `AI_MODEL=local-smoke`, key giả chỉ ở process environment và MongoDB replica set tạm. Ba case của live-smoke trả `mode=llm`, constraints đạt, process exit **0**; provider chuyển HTTP **503** thì case đầu dùng fallback và process exit **1**. Hai lượt này có **4 provider requests**, không retry và không gọi anomaly.
- Một lượt upstream HTTP **401** cục bộ riêng: đúng **1 provider request**, service fallback và live-smoke exit **1**; không lộ sentinel trong error body, không retry hoặc gọi anomaly.
- Lightpanda chạy frontend production build qua Vite preview, backend `NODE_ENV=development` và Redis 7 trong container riêng. Guest vào bàn, gọi gợi ý với budget 40.000đ, nhận badge **AI**, món 35.000đ/evidence từ DB; chọn món và đi qua `/ai/recommendations/validate` trước khi giỏ có một món. HTTP 503 đổi badge sang **Gợi ý theo menu** và vẫn giữ giá/budget.
- HTTP request từ phiên guest Lightpanda với cả `noCaffeine=true`, `noDairy=true`, budget 40.000đ: **200**, `mode=llm`, giá/evidence 35.000đ, caffeine/dairy đều `false`. Kiểm tra limiter bằng 31 request input rỗng: **19 HTTP 422, 12 HTTP 429**; không phát sinh inference cho các request này.
- Lightpanda screenshot là text-only, không phải bằng chứng layout/CSS đầy đủ. Automation checkbox không giữ trạng thái sau các thao tác đã thử; phần UI checkbox chưa được xác nhận. Không chuyển sang Chrome để thay thế; quy tắc browser nằm trong `AGENTS.md`.
- `docker compose -f compose.production.yaml config --quiet`: **PASS**. Đây là kiểm tra cấu trúc, không tự chứng minh container startup hay live provider.
- Full stack production cô lập `qr-ai-production-smoke`, database fixture `qr_ai_acceptance`: build/recreate thành công, migration hoàn tất; MongoDB, Redis, bốn API replicas, ba workers và web đều healthy. Gateway `/healthz` trả `ok`; `/api/v1/health` trả **200** từ guest replica. Cả hai AI modes cố ý đặt `fallback`.
- Kiểm chứng `--env-file` bằng `/tmp/qr-ai-production-smoke.env.production` chứa fixture cấu hình ngoài repo: `config --quiet` và `up --force-recreate --wait` đạt; API/workers nhận cấu hình, toàn stack healthy. Lightpanda vào lại Guest 8080 sau lượt recreate này và nhận card fallback 35.000đ. Không đọc/sửa `.env.production` thật hoặc dùng credential provider thật.
- Lightpanda tại cổng **8080**: join bàn **200**, gọi `/ai/recommendations` **200**, badge **Gợi ý theo menu**, món 35.000đ trong budget 40.000đ; chọn món, `/ai/recommendations/validate` **200**, UI xác nhận một món trong giỏ. Lượt đầu dùng portal origins mặc định khác cổng đã bị **403** đúng bởi origin guard; sau rebuild/recreate với origins 8080/8081/8082 thì đạt, không bỏ qua guard.
- Cleanup hoàn tất: đóng các browser sessions thử nghiệm, dừng Lightpanda CDP, bỏ stack `qr-ai-production-smoke` và chỉ hai volumes fixture của project này; dừng container Redis thử nghiệm riêng. Harness/runtime tạm đã dừng hoặc xóa; file env fixture ngoài repo được xóa. Không commit/push.

Các kiểm tra trên không dùng key thật, không seed/reset database của người dùng và không sửa `.env` thật. Provider cục bộ không chứng minh chất lượng model, chi phí, latency hay khả năng Zen JSON-mode.

### Evidence và kiểm tra cấu hình cuối — 23/09/2026

Mỗi recommendation nay kèm evidence do backend dựng từ đúng product/variant trong MongoDB: giá được kiểm chứng, ngân sách, caffeine và dairy. Lý do hiển thị không dùng trực tiếp câu khẳng định do LLM tự sinh.

Trước khi thêm món từ AI vào giỏ, client gọi `POST /api/v1/ai/recommendations/validate` với variant/topping cuối cùng. Backend kiểm tra lại availability, topping được phép, tổng giá gồm topping và toàn bộ ràng buộc. Metadata dairy/caffeine chưa biết không được coi là đạt. Integration đã xác nhận variant 45.000đ + topping 8.000đ bị chặn khi ngân sách 40.000đ, đồng thời topping không có metadata dairy không được khẳng định là không sữa.

## Đảm bảo an toàn chung

- Hai endpoint chỉ đọc menu; không thể tạo đơn, hủy đơn, thanh toán hoặc đổi phiên bàn.
- Input qua Zod và shared Redis rate limit; search giới hạn 200 ký tự, AI Barista giới hạn 500 ký tự.
- Câu nhập không được chuyển thành Mongo query, lệnh hệ thống hoặc dữ liệu giá.
- ID/variant/availability/price đều được whitelist và kiểm tra lại từ database.
- Metadata thiếu không được xem là đáp ứng ràng buộc `không caffeine` hoặc `không sữa`.
- Đây là bộ lọc sở thích theo metadata, không phải cam kết y tế hay dị ứng.
