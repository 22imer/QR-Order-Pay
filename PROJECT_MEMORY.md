# Bộ nhớ dự án — Fantastic cafe

Cập nhật: 21/10/2026.

## Đồng bộ GitHub theo yêu cầu user — 21/10/2026

- User yêu cầu push toàn bộ công việc hiện tại lên remote `origin` = `https://github.com/longdxam/QR-Order-Pay`, nhánh `main`. Phạm vi gồm #6 mang đi/đặt trước, #11 workforce và các sửa AI/thông báo/giao diện/giỏ nổi; những ghi chú “chưa commit/push” bên dưới là trạng thái lịch sử trước yêu cầu này.
- Trước commit đã fetch, HEAD và origin/main không lệch; kiểm 81 file được stage, whitespace và quét mẫu secret không có phát hiện. `.env`, `apikey.txt`, `.cache`, dependencies/build output vẫn bị ignore. Không thay dữ liệu hay runtime khi đồng bộ Git.

## Trang đặt món mang đi và giỏ nổi — 21/10/2026

- Theo yêu cầu user, trang khách `/pickup` nay có giao diện riêng cùng thương hiệu QR: nền xanh đậm phối kem/đào, hero ảnh vòm và thẻ món ảnh lớn. Giữ ít chữ, lọc danh mục/tìm kiếm, phân lô 6 món. `PickupStorefront.tsx` + CSS riêng; Staff/Admin giữ form tại quầy.
- **Giỏ mang đi nổi cố định** cuối màn hình kể cả 0 món, luôn hiện số lượng/tổng tiền. Bấm mở bảng giỏ để tăng/giảm/xóa món, nhập người nhận, chọn nhận ngay/hẹn giờ; Voucher & điểm thu gọn. Header bảng và vùng đặt đơn sticky, điện thoại dùng sheet từ đáy. Mở/đóng giỏ không tự gửi đơn; nháp qua tab, quote, pending recovery/retry cùng payload và giỏ bàn độc lập vẫn giữ. Pending bất định tự mở bảng giỏ và khóa sửa. PWA **v23**.
- Client toàn bộ **100/100 PASS**; sau thêm test lọc danh mục/tìm/phân lô, route suite cuối **5/5 PASS** (101 ca client hiện có). Client lint/TypeScript+build và Docker web build PASS. Logs `.cache/pickup-storefront-{tests,routes,lint,build,docker-build-final}.log`. Bổ sung kiểm giỏ rỗng, mở giỏ không POST, tăng/giảm/xóa/tổng tiền; route tests qua tab và retry cập nhật theo bảng giỏ.
- Lightpanda + DB tạm PASS login riêng → chọn/AI → giỏ nổi/đổi số lượng → giữ nháp qua tab → TAKEAWAY/PICKUP giờ VN → lịch sử/Staff thấy đơn; 0 table-session reads trong pickup, không phiên giả; QR gate và giỏ bàn không đổi khi chuyển luồng. 0 JS exception/5xx, `.cache/pickup-storefront-lightpanda.log`. **DOM/hành vi; màu sắc, bố cục thực tế, có bị che trên màn hình/thiết bị thật chưa xác minh trực quan.**
- Đã build/recreate riêng web, healthy, giữ Guest8080/Staff8081/Admin8082; local Lightpanda read-only PASS health/PWA23/isolation/deep links/auth/QR gate, `.cache/pickup-storefront-local-smoke.log`. Không đổi backend/migration/secret/QR, không seed/reset hay tạo giao dịch thử trên quán. Browser/relay tạm dọn; chưa commit/push. `docs/pickup.md` có 19 ca tự test. User mở `http://localhost:8080/pickup`, Ctrl+F5.

## Tách trang mang đi khỏi luồng QR — 21/10/2026

- User yêu cầu Mang đi/đặt trước thành trang riêng, tách luồng quét QR. Đã tạo **PickupLayout** độc lập GuestLayout với `/pickup` (form/thực đơn/AI/giỏ), `/pickup/orders` (đơn chính chủ) và `/pickup/member` (đăng nhập/thành viên). Không đọc guest-session, không kết nối socket bàn, không có table badge/cart pill/gọi nhân viên/rời bàn trên trang này. Link Tại quán → `/t`; JoinPage có link Đặt mang đi / đặt trước. Vẫn cùng Guest origin 8080 và tài khoản member cookie 14 ngày, không đổi auth backend.
- Member login/register trong `/pickup/member` tự về `/pickup`; backlink điểm dùng pickup thay vì cart bàn. Guest PickupPage mở form ngay ở tab Đặt món, tạo xong/đóng nháp sang `/pickup/orders`; Staff/Admin giữ view tất cả cũ. **PickupDraftContext** giữ nháp thường trong bộ nhớ qua chuyển tab, kiểm owner/storageKey, xóa khi gửi thành công/đóng nháp. Pending create bất định tiếp tục sessionStorage/payload/key/reload guard như trước.
- Quyết định mới **thay thế ghi chú cũ auto chuyển Menu/AI ngoài bàn sang pickup**: `/menu` và `/ai` nay là luồng tại bàn, chưa có QR thì yêu cầu quét QR kể cả member đang đăng nhập; không tự chuyển đích giỏ. AI mang đi dùng nút Gợi ý AI trong form riêng và callback giỏ riêng. Đã giữ giỏ bàn khi chuyển sang pickup, kể cả cookie bàn còn hoạt động. PWA **v22**.
- **99 client tests PASS**, lint/typecheck/build/Docker web build PASS. Thêm 3 tests route auth/canonical redirect/không table API, draft qua tab/không sửa table cart, pending recovery/retry cùng request rồi history. Test routing cũ cập nhật theo yêu cầu mới. Logs `.cache/pickup-separate-{tests,lint,typecheck,build-final,docker-build}.log`.
- Lightpanda + DB tạm PASS pickup direct → login riêng → catalog/AI/giỏ qua tab/create/orders **0 table-session reads/0 fake table sessions**; table menu/AI QR gate; QR → table cart → đổi sang pickup giữ nguyên cart bàn; PICKUP giờ VN dù có cookie bàn active; Staff thấy cả đơn. 0 exception/5xx. `.cache/pickup-separate-lightpanda.mts`, `.cache/pickup-separate-lightpanda.log`. Chỉ DOM/hành vi; layout trực quan/thiết bị thật chưa xác minh.
- Đã build/recreate riêng web, healthy/giữ cả 3 portal; không backend/migration/seed/reset/secret/QR hoặc giao dịch thử trên quán. Local Lightpanda PASS PWA22/health/isolation cả deep link/đăng nhập+đơn pickup không table reads/chuyển QR/menu QR gate, 0 exception/5xx; `.cache/pickup-separate-local-smoke.log`. Browser/relay tạm dọn. README/docs pickup cập nhật **18 ca tự test**. Chưa commit/push. Link user: `http://localhost:8080/pickup`; Ctrl+F5 nhận bản mới.

## Chặn giỏ tại bàn khi chưa vào bàn — 21/10/2026

- User báo từ thực đơn chưa vào bàn vẫn có toast Đã thêm vào giỏ. Lần sửa trước chỉ nối đường AI, **MenuPage dùng ProductDetailModal mặc định vẫn gọi cart.add vô điều kiện**. Đã gom xử lý mặc định vào ProductDetailModal: không bàn + chưa member → nút Đăng nhập để đặt, chuyển `/member`, không add/toast success; không bàn + member → nút Chọn mang đi, chuyển item đã tùy chỉnh sang nháp `/pickup` gắn member, toast Đã chọn món mang đi; có bàn → cart tại bàn như cũ.
- Modal chặn lúc đang kiểm member, lỗi member không báo thành công; callback onAdd có thể trả false để bỏ success. AISheet bỏ callback chuyển riêng, dùng cùng guard mặc định; callback giỏ pickup/counter vẫn hoạt động. Không đổi backend, giá, auth hay nghiệp vụ đặt/thu. **PWA v21**.
- **96 client tests PASS**, lint/TypeScript+build/Docker web build PASS. Thêm 3 regression cho chọn trực tiếp có member/anonymous/lỗi kiểm tài khoản, giữ 3 ca AI/giỏ đúng. Logs `.cache/menu-cart-guard-{tests,lint,build,docker-build}.log`. Lightpanda DB tạm PASS đường Menu thật anonymous→login/no toast/no orphan cart và member→pickup nháp/toast riêng, cấu hình/giỏ/hẹn/Staff cũ, 0 exception/5xx; `.cache/menu-cart-guard-lightpanda.log`.
- Đã recreate riêng web, healthy/giữ ba portal. Lightpanda local PASS health/PWA21 ba portal, Menu khách chưa bàn/chưa member → login, không success toast/giỏ mồ côi/exception/5xx; `.cache/menu-cart-guard-local-smoke.log`. Không seed/reset hoặc tạo giao dịch/QR thử trên quán; browser/relay tạm đã dọn. Chỉ DOM/hành vi, không bằng chứng render trực quan. Chưa commit/push. User Ctrl+F5 để nhận nút mới.

## Rút gọn chữ giao diện khách — 21/10/2026

- User muốn giao diện khách ít chữ hơn. Pickup phía khách bỏ subtitle/header nháp/hướng dẫn lặp, tên phần Nhận món/Chọn món/Giỏ hàng ngắn, thẻ chỉ ảnh/tên/giá/dấu +, nút Gợi ý AI/giỏ gọn; Staff giữ hướng dẫn và caption thẻ. Vẫn giữ thông tin giờ hẹn, giá đổi, lỗi và pending/retry. Không thay nghiệp vụ.
- AI bỏ mô tả lặp, rút ngắn preset/nhãn; Member chuyển chính sách điểm/phiên 14 ngày/SMS vào details **Quyền lợi & tài khoản** đóng mặc định; Cart có details **Cách đổi điểm**. Mô tả filter Menu ngắn hơn. aria-label quan trọng giữ để điều khiển và trợ năng.
- **93 client tests PASS**, client lint + TypeScript/build + Docker web build PASS. Lightpanda DB tạm PASS help đóng/mở, nội dung guest gọn/card không lặp caption, tìm/xem thêm/tùy chỉnh/giỏ/hẹn giờ/đóng nháp, Staff cũ; 0 JS exception/5xx. Logs `.cache/guest-copy-{tests,lint,build,docker-build,lightpanda}.log`. Chỉ DOM/hành vi, **bố cục trực quan/thiết bị thật chưa xác minh**.
- Đã recreate riêng web, **PWA v20**, healthy, giữ ba portal chạy; không đổi backend/migration/data/secret/QR, không seed/reset hay đặt/thu thử trên quán. Local Lightpanda read-only PASS health/PWA20/isolation/member gate/Staff-Admin nav/list/catalog/draft/history/workforce/logout, `.cache/guest-copy-local-smoke-final.log`. Harness lần đầu locator exact tên link không tính badge trên đơn user đã tạo nên timeout; đã chọn href, lượt cuối PASS. Browser/relay tạm đã dọn. Chưa commit/push.

## Sidebar và giao diện tạo đơn mang đi — 21/10/2026

- User gửi ảnh số badge Mang đi bị cắt ở sidebar và yêu cầu món lớn/dễ nhìn hơn khi tạo đơn. `InternalShell` cho tên mục desktop xuống dòng/min-width 0, badge không co và tăng vùng hiển thị; mobile tiếp tục thanh ngang. Không đổi độ rộng sidebar hay luồng điều hướng.
- Pickup form dùng chung Guest/Staff/Admin: chia thông tin nhận món → chọn món → giỏ/ưu đãi; lựa chọn nhận ngay/hẹn giờ có thẻ và mô tả. Ảnh món lớn tỷ lệ 4:3, tên/giá lớn, gợi ý Tùy chỉnh & thêm, giá từ variant đang bán. Bỏ khung max-height/scroll riêng, hiện 6 món/lượt và Xem thêm, search reset về 6, có rỗng và số kết quả. Có nút tới giỏ, ảnh trong giỏ và nút đặt lớn hơn. Giữ nguyên quote/idempotency/pending recovery/AI và logic tiền/kho.
- Client suite **92/92 PASS**, sau thêm test phân lô/tìm/chọn món thứ 7 kiểm lại **pickup 10/10 PASS**. Client lint/TypeScript+build/Docker web build PASS. Lightpanda + DB tạm PASS Guest/Staff 6→7 món, tìm/chọn/tùy chỉnh/thêm, hẹn giờ, tới giỏ, đóng nháp và markup sidebar nhãn wrap/badge không co; không JS exception/5xx. **Chỉ DOM/hành vi; clipping/layout thực tế, kích thước hiển thị/thiết bị thật chưa được chứng minh trực quan**, user cần xem lại. Logs `.cache/pickup-ui-{tests,paging-test,lint,build,docker-build,lightpanda}.log`.
- Đã build và recreate **riêng web** bằng no-deps/no-build, PWA **v19**, web healthy. Lightpanda local read-only PASS 3 portal/health/isolation/member gate/nav/draft/history/workforce/logout, không exception/5xx; `.cache/pickup-ui-local-smoke.log`. Không đổi backend/migration/secret/QR, không seed/reset hoặc tạo giao dịch thử trên quán. Browser/relay tạm dọn; giữ stack chạy, chưa commit/push. User Ctrl+F5 Guest/Staff/Admin để xem bản mới.

## AI mang đi, thông báo đơn mới và phiên thành viên — 21/10/2026

- User phản ánh AI chưa dùng được khi mang đi/chưa vào bàn, Staff không được báo đơn mới và hỏi vì sao quét QR vẫn đăng nhập thành viên. User chọn **thông báo nổi + số đếm + âm báo**. AI recommendations/validate nay nhận phiên QR hoạt động **hoặc thành viên hợp lệ**, giữ CSRF/rate limiter/no-store; không cấp quyền gọi món tại bàn chỉ bằng thành viên.
- `AISheet` nhận callback thêm món cho đơn nháp pickup; ngoài bàn dùng member identity chuyển món đã tùy chỉnh qua router state sang nháp mang đi. Trong bàn vẫn dùng cart tại bàn; không tự gửi đơn. Pending create chưa rõ kết quả vẫn được ưu tiên và không thay payload/key. Có nút **Hỏi AI cho đơn mang đi** trong nháp khách, giữ bước validate cấu hình và quote/tồn. PWA **v18**; `/ai` được dùng ngay cả khi còn receipt phiên cũ.
- Staff thêm badge Mang đi theo **total active** cả các trang. `useNewOrderAlerts` báo ngay `order.created` kể cả AWAITING_PAYMENT, phân biệt tại bàn/mang đi; toast + âm theo nút loa + OS notification nếu có quyền. Polling ID dự phòng, không báo lịch sử lần tải đầu/replay trùng; không đợi đến PAID/KDS. WebAudio mở sau thao tác bấm/phím và bắt lỗi resume. `useSocketEvent` đã sửa gate dedupe **riêng từng subscriber**: trước đó listener layout có thể tiêu thụ event khiến trang không nhận.
- Thành viên `mc_member` **14 ngày**, dùng chung tại bàn/mang đi trên cùng trình duyệt; QR chỉ cấp guest capability, không tạo/đăng nhập member. Rời bàn không logout member. Đã giải thích cho user và thêm mô tả trên trang Thành viên; không đổi chính sách auth này.
- **382 tests PASS = 105 unit + 185 integration + 92 client**; lint/typecheck/build PASS. Lightpanda hai browser + DB tạm PASS AI ngoài bàn → pickup → Staff toast/badge/list 629ms; AI nhúng nháp; thông báo đơn tại bàn chưa thu; member giữ sau QR; AI tại bàn đúng giỏ; không JS exception/5xx. WebAudio dùng stub để kiểm đường gọi; **âm loa thật/OS notification, CSS/layout và điện thoại thật chưa xác minh**, provider live chưa thử. Logs `.cache/pickup-feedback-{unit,integration,client-complete,lint-final,typecheck-verified,build,lightpanda}.log`.
- Hướng dẫn `docs/pickup.md` có **17 ca test**, OpenAPI/test-report cập nhật. Backup trước cập nhật `.cache/maycafe-before-pickup-feedback-20261021.archive.gz`. Đã build Docker server/web rồi recreate stack; cùng artifact Node dùng cho 4 API/3 worker/migrate, migrate exit0/skip toàn bộ, không migration mới. Toàn stack healthy, Guest8080/Staff8081/Admin8082 giữ chạy; public tunnel vẫn tắt. Build song song ban đầu gây áp lực RAM nên dừng rồi dựng server/web tuần tự thành công; không sửa dependency/Dockerfile. Logs `.cache/pickup-feedback-{docker-server,docker-web,deploy}.log`.
- Fingerprint/hash/count **21 collection nghiệp vụ trước/sau bằng nhau**, `.cache/pickup-feedback-business-{before,after}.json`. Lightpanda local read-only PASS health/PWA18/isolation, Guest member gate, Staff/Admin login/nav/list/catalog/mở-đóng nháp/history/workforce và logout, 0 JS exception/5xx; `.cache/pickup-feedback-local-smoke.log`. Browser/relay tạm đã dọn. Không seed/reset, đổi secret/QR hay tạo giao dịch thử trên quán; chưa commit/push. User cần Ctrl+F5 Guest/Staff; bấm vào trang Staff để mở quyền âm và dùng nút loa bật/tắt. #10 chưa bắt đầu.

## Bật lại web để user tự test #6 — 21/10/2026

- Theo yêu cầu user, đã bật lại toàn stack hiện có bằng `docker compose -f compose.production.yaml up -d --wait`, không rebuild/seed/reset hoặc đổi cấu hình. Mongo/Redis, 4 API, 3 worker và web healthy; migrate exit0, tất cả migration gồm pickup đã có nên skip. Giữ Guest8080/Staff8081/Admin8082 chạy; public tunnel không bật.
- Lightpanda read-only PASS health/PWA17/API+SPA isolation, Guest menu→Mang đi→member gate, Staff/Admin login/nav/list/catalog/draft mở-đóng/history và workforce cũ; không JS exception/HTTP5xx, đã logout. Không tạo đơn/thu tiền/kho/voucher/member/QR thử. Logs `.cache/pickup-restart-20261021.log`, `.cache/pickup-restart-smoke-20261021.log`; browser/relay tạm đã dọn. DOM/hành vi, chưa chứng minh CSS/layout/thiết bị thật. Không chạy lại suite vì không đổi source.
- Ổ C hiện trống khoảng **31,9 GB**, D khoảng 30,3 GB; cảnh báo ~200MB của lượt trước là lịch sử, không còn phản ánh lần kiểm tra này. User được gửi link ba portal, các kịch bản và kết quả mong đợi; hướng dẫn đầy đủ 14 ca ở `docs/pickup.md`. Chưa bắt đầu #10, chưa commit/push.

## Mang đi và đặt trước nhận tại quầy (#6) — 20/10/2026

- User đã chọn rõ: **khách đăng nhập thành viên SĐT + mật khẩu; nhân viên tạo tại quầy; xác nhận thu đủ tiền mới pha, có thể trả khi tới quầy**. Đã hoàn thành source và triển khai local. Guest `/pickup` (link Mang đi), Staff `/staff/pickups`, Admin `/admin/pickups`; giỏ riêng, dùng tùy chỉnh món thật. Counter nhập contact nhưng không tự gán member/điểm theo SĐT chưa xác thực.
- TAKEAWAY nhận ngay, PICKUP hẹn từ 15 phút tới 7 ngày, giờ VN độc lập timezone máy. Khách tối đa 3 đơn active, chống race qua write guard Member; counter namespace riêng. Danh sách phân trang 30, active/history; khách chỉ xem/hủy/hóa đơn chính chủ. Cache gắn identity; pending create giữ payload/requestId trong sessionStorage theo tài khoản/portal qua reload, khóa sửa khi mất phản hồi/5xx.
- Order thêm `fulfillmentType` và `pickup` contact/scheduledAt/outcome. DINE_IN legacy tương thích và vẫn kiểm table/session; pickup tableId/tableSessionId null, không tạo bàn/phiên giả. Dùng chung signed quote gắn owner + contact/giờ, pricing/options, voucher/điểm, inventory snapshot, Payment/CashShift, correction, audit/outbox và WorkActivity. Đặt giữ kho/ưu đãi; PREPARING trừ; CANCELLED trước pha trả giữ. Thu từng phần/0đ/replay không cần table claim; version Order chống hai người thu cùng lúc.
- KDS chỉ nhận PAID; đơn hẹn vào từ 15 phút trước giờ nhận, API chặn pha sớm. Tuổi chờ KDS không cộng thời gian đợi đến giờ hẹn. Giao thực tế SERVED → COLLECTED, tích điểm + Bill snapshot cùng transaction. Bill pickupOrderId unique; Admin xem/in lại, Staff in, khách xem; giữ cả mã voucher/điểm/options. Correction vẫn cần quản lý khác duyệt, không sửa Bill đã chốt.
- Hủy chưa thu/chưa pha có reason/version; đã thu phải hoàn thực tế toàn bộ trước pha. No-show thủ công sau hẹn 30 phút (TAKEAWAY sau tạo 60 phút): chưa thu/chưa pha hủy/trả giữ; đã thu/chưa pha hoàn trước. Đã pha giữ tiêu hao/khoản thu, không tích điểm; outcome NO_SHOW giữ công đoạn lịch sử, loại khỏi KDS/active queue/anomaly preparation và chốt Bill nếu đã thu. Không tự hoàn ngân hàng/no-show.
- Migration **20261020-001-pickup-indexes** tạo partial unique mới trước rồi bỏ đúng hai unique cũ áp dụng null (Order session+key, Bill session), giữ bảo vệ tại bàn; thêm owner+request, due/outcome và pickup Bill unique. Không backfill/sửa/xóa document. Auth/role/traffic isolation, no-store, contact DTO riêng; event staff không tên/SĐT, guest pickup polling 10s, nội bộ socket/reconnect + polling.
- **373 tests PASS = 105 unit server + 184 integration + 84 client**, thêm 18 integration + 9 client. Toàn server suite đã đạt; sau bổ sung filter vận hành/invoice metadata kiểm lại 18 pickup + 10 anomaly = 28 PASS; client cuối toàn 84 tuần tự PASS. Typecheck/lint và Docker production build cuối PASS. Một lượt lặp client song song/root build host khi Docker build thiếu bộ nhớ; chạy lại client maxWorkers=1 đạt, Docker đã compile cả server/client thành công. Logs `.cache/pickup-{unit,integration,client-final,final-regression,final-client,typecheck,lint,docker-build-final}.log`.
- Lightpanda build cuối + DB tạm PASS login/tùy chỉnh/đặt/thu/4 công đoạn/giao/điểm/invoice, hẹn giờ VN/hủy/trả kho, counter/no-show, guest invoice không nút in; migration compiled apply/rerun giữ hash **31 collection fixture**, không JS exception/5xx. `.cache/pickup-lightpanda-20261020.mts`, `.cache/pickup-lightpanda-final.log`. Fill datetime của Lightpanda chỉ đổi DOM, harness cần native setter + dispatch input/change. **Native datetime picker/dropdown, CSS/layout trực quan, máy in và điện thoại thật chưa xác minh**.
- Runtime ban đầu đã dừng; đã bật Docker/dependencies, backup **`.cache/maycafe-before-pickup-20261020.archive.gz`** (SHA256 `583373299e1002171266cf9de6122f2412645b7f109d3f15057e1bfe2a3114e1`), build/recreate/apply migration. Hash/count **21 collection nghiệp vụ** trước/sau migration và sau smoke bằng nhau: `.cache/pickup-business-{before,after,final}.json`. Không seed/reset hoặc tạo giao dịch/dữ liệu pickup thử trên quán, không đổi `.env`/secret/QR. Guest8080/Staff8081/Admin8082 healthy, migrate exit0, public tunnel dừng.
- Lightpanda read-only local PASS health/PWA17/API+SPA isolation, Guest menu→Mang đi→member gate, Staff/Admin login/nav/list/catalog/form mở-đóng/history và workforce cũ; không JS exception/5xx, logout xong. `.cache/pickup-local-smoke-20261020.mjs`, `.cache/pickup-local-smoke.log`. Browser/relay tạm đã dọn. Đã dọn 18,83 GB build cache và TRIM ~14,8 GiB Docker disk; Windows vẫn chỉ báo **~200 MB ổ C trống** do VHDX chưa thu nhỏ. Chưa compact/restart Docker để giữ app đang phục vụ; cần xử lý dung lượng tiếp. Không xóa image/container/volume nghiệp vụ hoặc dữ liệu cá nhân.
- Hướng dẫn + **14 kịch bản tự test**: `docs/pickup.md`; README/OpenAPI (22 path pickup), YAML/whitespace PASS. Chưa có giao hàng, booking công suất/giờ mở cửa, SMS/Telegram, tự pha/nhắc nhận, sửa giờ hẹn hay đánh giá pickup; giữ kho/điểm/lượt từ lúc đặt, chưa expiry tự động. Top món/gợi ý nhân sự vẫn theo thời điểm tạo đơn PAID; thu/hoàn theo ngày giao dịch. #6 và #11 **chưa commit/push**. Tiếp tục feedback; mục kế tiếp dự kiến **#10 Đặt bàn**, không tự bắt đầu.

## Đồng bộ realtime lịch ca Admin/Staff — 19/10/2026

- User phản ánh phải tải lại mới thấy lịch. Thêm `workforce.changed` vào contracts/socket/queue; helper `workforceRealtimeService.ts` ghi outbox cùng transaction lịch/chấm công/correction/policy/copy, chỉ phát nội bộ `{refresh:true}`. Không đưa tên/ID/lịch nhân viên vào payload hoặc phát cho khách. Replay không tạo thêm event, copy cả tuần một event; lỗi outbox rollback nghiệp vụ/audit.
- AdminLayout kết nối socket JWT như StaffLayout. Workforce refetch khi có thay đổi lịch, `order.statusChanged` hoặc reconnect; polling 30 giây dự phòng. Lưu lịch ngoài tuần đang xem tự chuyển tới ngày bắt đầu ca; bản cũ đã invalidate nhưng vẫn ở khoảng không có ca mới. PWA **v16**.
- **346 tests PASS = 105 unit server + 166 integration + 75 client**, lint/typecheck/build PASS. Thêm 3 integration (event privacy/replay, rollback, copy atomic/one-event) và 4 client (Admin/Staff realtime, reconnect, chuyển tới ca ngoài tuần). Logs `.cache/workforce-realtime-{unit,integration-final,client,lint,typecheck,build}.log`. Một lượt integration đầu chạy cùng lúc sửa payload còn thất bại assertion; suite cuối 166/166 PASS.
- Lightpanda hai browser độc lập + DB tạm PASS UI Admin tạo/sửa/hủy → Staff tự thấy trong 202–242ms, Staff vào/ra → Admin trong 263–271ms, không reload/bấm tải lại và không JS exception/5xx. Harness/log `.cache/workforce-realtime-lightpanda-20261019.mts`, `.cache/workforce-realtime-lightpanda.log`. DOM/hành vi, chưa chứng minh CSS/layout/dropdown native/điện thoại thật.
- Backup `.cache/maycafe-before-workforce-realtime-20261019.archive.gz`, build/recreate stack local healthy, migration không có bản mới. Hash/count 21 collection nghiệp vụ trước/sau bằng nhau `.cache/workforce-realtime-data-{before,after}.json`. Lightpanda local PASS health/isolation/PWA16/navigation/report/CSV/privacy và outbox → Redis worker → socket → refetch Admin 789ms/Staff 522ms; chỉ thêm hai event chẩn đoán `{refresh:true}`, không ghi lịch/chấm công/đơn/thu tiền/kho/cấu hình. Phiên smoke logout, browser/relay tạm dọn; Guest8080/Staff8081/Admin8082 tiếp tục chạy. Docs workforce có 18 kịch bản. Chưa commit/push.

## Kiểm tra và bổ sung lịch sử demo cho gợi ý #11 — 19/10/2026

- User hỏi kiểm tra dữ liệu và **tạo đủ nếu thiếu**. Đã gọi trực tiếp cùng `workforcePeaks` của runtime: tuần từ 19/10, cửa sổ 21/09 00:00→trước 19/10 00:00 VN, có **18/20** đơn PAID không hủy nên chưa đủ.
- Đã backup `.cache/maycafe-before-workforce-history-demo-20261019.archive.gz`, thêm đúng **2 đơn DEMO 0đ** bằng script `scripts/setup-workforce-history-demo.mjs` (mặc định preview, `--apply` mới ghi), toàn bộ trong transaction. Dataset `workforce-history-demo-v1-20261019`, mã `D11-20261019-01/02`, thời điểm **13/10/2026 14:10/14:11 VN**. Mỗi đơn SERVED/PAID có session CLOSED, Payment OTHER/SUCCESS 0đ và Bill snapshot 0đ tương ứng; không fake WorkActivity/đánh giá/điểm/kho/ca tiền. Audit SYSTEM ghi rõ nhập demo theo yêu cầu, không gán thao tác KDS cho nhân viên.
- Thêm danh mục tắt/món archive giá0/bàn `DEMO-WF11` inactive, mọi tên/ghi chú có `[DEMO #11]`; không xuất hiện menu công khai, không cấp QR/guest session. Chỉ thêm bản ghi, hash tất cả bản ghi cũ trong 21 collection nghiệp vụ không đổi. Doanh thu tăng 0đ; số đơn/thống kê số lượng và lịch sử hóa đơn/khoản thu có thêm demo, đã giải thích cho user trước khi nạp. Không thay các ghi nhận giao dịch cũ hoặc cấu hình/lịch nhân sự.
- **Sau nạp 20/20, enoughData=true, 3 gợi ý**: thứ ba 14h (5 đơn/4 tuần, TB1,25); thứ tư9h và chủ nhật10h (mỗi khung3 đơn, TB0,75); định mức6 nên đều đề xuất1 người. Chạy lại apply: **0** bản ghi mới, đủ liên kết 1 payment+1 bill/đơn, tổng tiền0. Runtime source không đổi, không cần rebuild container; stack tiếp tục healthy.
- Lightpanda local PASS UI/API 20 đơn, ba nút Dùng gợi ý enabled, demo vắng menu public, không JS exception/5xx; không lưu policy/lịch, admin smoke đã logout. Log `.cache/workforce-history-demo-smoke.log`, harness `.cache/workforce-history-demo-smoke-20261019.mjs`; browser/relay tạm đã dọn. Chỉ DOM/hành vi, chưa xác minh CSS/layout trực quan.
- Hướng dẫn đầy đủ `docs/workforce-history-demo.md`; báo cáo `.cache/workforce-history-demo-{preview,apply,rerun}.json`, `.cache/workforce-history-check-before.json`, backup log cùng prefix. Script tính tuần hiện tại, không tự chạy định kỳ hoặc reset tồn; không chạy lại seed tổng. Các ghi chú lịch sử về không tạo đơn thử trên quán không áp dụng cho bộ dữ liệu **đã được user yêu cầu rõ ràng** này. Chưa commit/push.

## Hoàn thiện #11 và bật web local — 19/10/2026

- User yêu cầu chạy web và hoàn thiện #11; đã hỏi rõ phạm vi và user chọn **giữ phạm vi gồm gợi ý cao điểm từ lịch sử, đối soát ca thu ngân trong #11, sao chép lịch tuần và xuất bảng công CSV mở Excel**. Không triển khai xin nghỉ/đổi ca có duyệt hoặc tính lương. Những ghi chú “chưa chạy local” ở mục #11 bên dưới là lịch sử.
- Admin tab Nhu cầu có `peaks`: 4 tuần ngày hoàn chỉnh trước min(tuần chọn, hôm nay), PAID không hủy, ít nhất 20 đơn tổng, khung từ 3 mẫu, tối đa 12 khung; nhóm thứ/giờ Việt Nam và chia 4 tuần kể cả tuần 0 đơn. Đề xuất `ceil(TB đơn/giờ / ordersPerStaffHour)`, tối thiểu 1; định mức Admin cấu hình 1–100, mặc định/legacy 6. Dùng gợi ý mở bản nháp, quản lý bấm Lưu mới áp dụng; không ghi đè khung giao giờ. Form giữ version từ lúc mở, không tự dùng version mới khi background refetch.
- Tab Đối soát ca thu ngân hiển thị CashShift mở/chốt trong tuần hoặc đang OPEN, người mở/chốt, dự kiến/kiểm đếm/chênh lệch/giải trình. Hiện tối đa 50 ca (ưu tiên OPEN); tổng toàn bộ ca CLOSED theo closedAt trong tuần không bị cắt 50 dòng. Không quy chênh lệch cho người chỉ có lịch trùng giờ. Staff không nhận `cash`/`peaks`.
- Sao chép lịch có preview (read-only), snapshot/version nguồn và xung đột, rồi confirm UUID requestId; cả tuần trong transaction, giữ replay bằng model `WorkScheduleCopy`. Nguồn tối đa 200 ca bắt đầu trong 7 ngày, bỏ ca hủy; đích sau ít nhất 7 ngày/cùng thứ, phải tương lai. Khóa tài khoản, source đổi, lịch đích trùng thì không tạo ca nào. Bản sao SCHEDULED/version0/giờ công rỗng, không mang KDS/điều chỉnh. Thành công UI chuyển sang tuần đích; retry không nhân đôi. Thêm `workforceCopyService.ts`.
- CSV UTF-8 BOM qua endpoint riêng Admin/Staff: tổng hợp tuần và chi tiết ca/giờ gốc/hiệu lực/lý do, giờ VN; giờ tổng hợp cắt tuần, chi tiết cả ca ghi rõ. Staff chỉ xuất bản thân; chống công thức từ chuỗi tên/ghi chú kể cả whitespace/control prefix, `no-store`. Thêm `workforceReportsService.ts`, UI `WorkforceExtras.tsx`; PWA v15. Không thay schema/logic Order/Payment/Bill ngoài actor KDS của đợt #11 trước.
- **339 tests PASS = server 268 (105 unit + 163 integration), client 71**; bổ sung 7 integration + 5 client so với 327. Lint/typecheck/build PASS. Mới kiểm snapshot/source/target/conflict/all-or-nothing/audit rollback/copy race/replay/reset attendance, lịch sử PAID/múi giờ/4 tuần có tuần 0/định mức, tổng cash >50 dòng, privacy/CSV/formula, UI preview/retry/không lưu gợi ý ngầm/cash/CSV. Logs `.cache/workforce-complete-{unit,integration,integration-new,client,typecheck,lint,build}.log`.
- Lightpanda cô lập trên build cuối PASS toàn luồng #11 cũ + dùng gợi ý theo 24 đơn fixture và định mức3→2 người, xem cash fixture/giải trình, copy preview/confirm/reset và chuyển tuần đích, CSV response thực; 2 migration apply/rerun skip, hash 12 collection fixture không đổi, không JS exception/5xx. Harness `.cache/workforce-lightpanda-20261019.mts`, log `.cache/workforce-complete-lightpanda.log`. Restart browser tạm để xóa cache module giữa các lần harness; không dùng Chromium. **DOM/hành vi; chưa xác minh CSS/layout trực quan, dropdown native, mở Excel hay điện thoại thật.**
- Đã bật Mongo/Redis, backup đầy đủ replica set bằng mongodump --oplog tại `.cache/maycafe-before-workforce-complete-20261019.archive.gz` (93.309 byte, SHA256 `1b4c3e6490dff2feeb595fd9b03cf21d7c5968baecf9b39a7763aa3420cdb722`). Build toàn stack rồi chạy migration **003-workforce + 004-workforce-planning**; 004 chỉ thêm index replay và CashShift ngày, không backfill. Hash/count **21 collection nghiệp vụ** trước/sau migration bằng nhau: `.cache/workforce-complete-business-{before,after}.json`; script `.cache/workforce-complete-fingerprint.js`. Logs backup/docker/migration/local-start cùng prefix `workforce-complete-`. Không seed/reset/đổi secret/QR hoặc tạo dữ liệu mẫu #11 vào quán.
- **Runtime hiện đang chạy healthy:** web, 4 API Guest/Internal, 3 worker, Mongo/Redis; migrate exit0. Guest `http://localhost:8080/menu`, Staff `http://localhost:8081/staff/workforce`, Admin `http://localhost:8082/admin/workforce`. Migration gate lần up skip idempotent. Local Lightpanda read-only PASS login/nav/tab/report/copy form mở rồi đóng/cấu hình mở rồi đóng/API CSV Admin và Staff/privacy/route isolation/health/PWA15; không JS exception/5xx. Không submit lịch/chấm/copy/policy hoặc tạo đơn/thu tiền/kho trên dữ liệu quán; phiên thử đã logout. `.cache/workforce-complete-local-smoke-20261019.mjs`, `.cache/workforce-complete-local-smoke.log`.
- Tài liệu `docs/workforce.md` nay **16 kịch bản**, OpenAPI 13 path workforce parse PASS, whitespace PASS; README cập nhật. Container Lightpanda/relay tạm đã dọn sau kiểm tra, giữ app chạy; tunnel public không bật. Thay đổi #11 vẫn chưa commit/push. Điểm tiếp tục: user test/feedback #11; mục lộ trình sau dự kiến #6, không tự bắt đầu.

## Lịch ca, chấm công và hiệu suất nhân viên (#11) — 19/10/2026

- User yêu cầu tiếp tục #11. **Đã hoàn thành bản đầu trong source**, tách khỏi CashShift/đối soát tiền hiện có. Admin `/admin/workforce` xếp/sửa/hủy lịch, xem chấm công và hiệu suất; Staff `/staff/workforce` xem riêng lịch/báo cáo và vào/ra ca. Admin có thể được xếp ca và chấm công ở portal Staff. Navigation cả hai portal đã thêm mục tương ứng, route lazy-load, PWA v14.
- Lịch 7 ngày (mặc định thứ hai), nhập/hiển thị giờ Việt Nam UTC+7 kể cả máy dùng múi giờ khác; ca >0 đến 16 giờ, có thể qua đêm; chặn chồng lịch cùng nhân viên bằng write guard User trong transaction. Tạo có UUID requestId + hash; sửa/cancel/clock/correction/policy có expectedVersion và replay an toàn. Form mất mạng/5xx giữ payload/key, khóa sửa và cho thử lại. Client tạo UUID bằng getRandomValues để dùng được portal LAN HTTP khi randomUUID không có; query cache gắn userId, không dùng lịch cache của người trước sau đổi tài khoản.
- Vào ca bằng giờ server, chính chủ, từ 30 phút trước bắt đầu đến trước giờ kết thúc; chỉ một ca WORKING/người và không trùng giờ thực tế. Ra ca không tự chạy khi hết lịch; ca mở quá 24 giờ cần quản lý điều chỉnh. Ca đang làm vẫn hiện nút Ra ca khi chuyển sang tuần khác. Trễ là số phút nguyên sau bắt đầu trừ dung sai 5 phút; chưa vào khi đã hết lịch tính vắng, hủy không tính vắng. Chưa ra không tự cộng giờ; giờ đã chốt cắt theo ranh giới tuần Việt Nam.
- Admin điều chỉnh giờ thực tế cần đủ vào/ra + lý do, >0 đến 24h, không tương lai, trong ±12h quanh lịch, không trùng chấm công khác. Giữ nguyên clockInAt/clockOutAt gốc; effectiveInAt/effectiveOutAt + người/lý do sửa và audit before/after cùng transaction. Khóa sửa lịch sau vào ca; hủy/điều chỉnh ca của tài khoản bị khóa/xóa vẫn được, nhưng không xếp mới hay chấm qua tài khoản đó. Không có tính lương, giờ nghỉ, GPS/sinh trắc/xác minh hiện diện trong bản đầu.
- `WorkActivity` unique `(orderId,stage)` lưu actor/name/ca đang chấm lúc CONFIRMED/PREPARING/READY/SERVED, cùng transaction Order/kho/điểm/audit/outbox; không backfill/suy đoán đơn cũ, không yêu cầu chấm công mới được dùng KDS. Chưa có ca thì ghi Ngoài ca. Thời gian PREPARING→READY thuộc người/ca bắt đầu pha, theo tuần READY; sao là đánh giá **đơn đã giao** gắn người SERVED, có số mẫu, không phải điểm cá nhân. Thẻ ca có counts/pha TB/sao theo snapshot ca; sửa giờ sau không gán lại sự kiện. Không đưa dữ liệu nhân sự vào DTO khách/Bill.
- Admin cấu hình khung nhu cầu theo thứ/giờ/số người tối thiểu (có thể đặt cao hơn giờ cao điểm), tối đa 100 khung, không chồng cùng ngày. Mặc định rỗng, không tự đoán ngưỡng. Coverage lấy **mức đồng thời thấp nhất cả khung**, phát hiện lỗ hổng giữa ca, loại người khóa/xóa; khung đang diễn ra có số đang WORKING riêng. Không phân bổ chênh lệch CashShift cho người có lịch trùng giờ; xem đối soát ca thu ngân hiện có.
- Models `WorkShift`, `StaffingPolicy`, `WorkActivity`; contracts `workforce.ts`, service/controller tương ứng. Migration **`20261019-003-workforce-indexes` chỉ thêm index**, đã apply/rerun skip trên Mongo tạm và hash 10 collection fixture trước/sau không đổi. Hướng dẫn/quy tắc/API + **12 kịch bản tự test**: `docs/workforce.md`; README và OpenAPI đã cập nhật.
- **327 tests PASS = server 261 (105 unit + 156 integration), client 66**; thêm 23 integration và 9 client. Bao phủ auth/ownership/cache đổi tài khoản, strict dates/timezone/qua đêm, duplicate/replay/version, hai quản lý tranh lịch/policy đầu tiên, KDS đồng thời ra ca, quên ra >24h, correction overlap/giờ gốc, rollback schedule/attendance và Order/activity/audit/outbox, coverage minimum/gap/disabled, sample counts/review/preparer attribution/legacy không backfill. Lint/typecheck/build PASS, OpenAPI YAML và whitespace PASS. Logs `.cache/workforce-{unit,integration,integration-new,client,typecheck,lint,build}.log`; test TEMP/TMP đặt `D:\codex-workforce-temp-20261019`.
- Lightpanda cô lập PASS navigation Admin/Staff, form xếp/sửa ca giờ VN, cấu hình/thiếu người, vào ca → 4 công đoạn KDS thật → báo cáo/mẫu/sao → ra ca, Admin correction giữ giờ gốc/snapshot, hủy ca với lý do, migration apply/rerun, không JS exception/HTTP 5xx. Harness/log `.cache/workforce-lightpanda-20261019.mts`, `.cache/workforce-lightpanda.log`. Lightpanda lookup wrapping label của select kèm text option nên harness chọn trực tiếp control `select[name=staffId]`, xác minh API/DB; không launch Chromium. **DOM/hành vi, chưa có bằng chứng CSS/layout trực quan, dropdown native hay điện thoại thật.**
- **Runtime local đang dừng từ trước khi làm #11**, khác bản ghi healthy của các đợt trước. Giữ nguyên trạng thái đó; không build/recreate production-local, áp migration lên DB quán, seed/reset, tạo ca/chấm công/đơn/khoản thu thử, sửa `.env`/QR hoặc gọi AI provider thật. Container Lightpanda tạm đã dừng/xóa; Docker không có container đang chạy khi kết thúc. Muốn tự test #11 trên 8081/8082 cần build/recreate stack và chạy migration bằng Compose gate hiện có; chưa thực hiện trong lượt này. Thay đổi #11 **chưa commit/push**, HEAD quan sát `de2ac94` của checkpoint kho/voucher/điểm.

## Checkpoint Git cho kho, voucher và tích điểm — 19/10/2026

- User yêu cầu commit/push các thay đổi hiện có lên Git. Phạm vi gồm #4 kho/công thức và dữ liệu mẫu/hướng dẫn, #5 voucher/thành viên SĐT + mật khẩu, kết hợp voucher + điểm theo từng mã, cùng tài liệu/bộ nhớ/test. Nhánh `main`, remote `origin` = `longdxam/QR-Order-Pay`; trước commit local và origin cùng `77b3763`.
- Các kiểm tra của source đã PASS: lint/typecheck/build, 295 tests (238 server + 57 client), Lightpanda cô lập và read-only local. Không chạy lại suite vì lượt push chỉ bổ sung bản ghi checkpoint, không đổi code. `.env`, `apikey.txt`, `.cache`/backup/logs/build output không đưa vào commit. Giữ nguyên stack local đang healthy, không thay dữ liệu quán.

## Cho phép voucher kết hợp điểm theo từng mã — 19/10/2026

- Theo yêu cầu mới nhất của user, **thay quy tắc chỉ voucher hoặc điểm** của bản #5 đầu tiên: Admin có checkbox **Cho phép dùng kèm điểm** khi tạo/sửa voucher (`allowPointRedemption`). Mặc định false; voucher cũ thiếu field cũng false. Không tự bật cho mã có sẵn, không cần migration hoặc viết lại database.
- Thứ tự tính: tiền món → giảm voucher (điều kiện tối thiểu vẫn dựa tiền món gốc) → giảm điểm tối đa 50% phần còn lại, không vượt số dư → tổng thực trả; chỉ tích `floor(thực trả/10.000)` khi PAID + SERVED. Ví dụ 60k − voucher10k − 10 điểm = 40k, tích 4; nếu đủ số dư, đổi tối đa 25 điểm sau voucher10k. Voucher giảm hết còn 0 thì không đổi thêm điểm.
- Giỏ giữ nguyên cả mã và điểm khi nhập/chỉnh hoặc bị từ chối, không tự xóa lựa chọn; quote trả `voucherAllowsPoints`/`maxRedeemPoints`. Preview đọc chính sách voucher trước nếu khách nhập cả hai ngay từ đầu để vẫn hiển thị giới hạn khi chọn quá nhiều điểm. Metadata giữ theo món/mã/member, không mất khi sửa số điểm. Server luôn kiểm lại flag/version/quota/balance trong transaction trước khi đặt.
- Cả hai khoản giảm đã có snapshot Order/Bill/receipt/in lại; hủy chưa thu hoặc hoàn tổng net trước pha chế trả lại cả điểm và lượt đúng một lần. Giữ transaction/idempotency cũ, rollback cả hai nếu lỗi. Số dư preview không thuộc fingerprint giá nên cộng thêm điểm ở đơn khác không tự làm hỏng báo giá còn hợp lệ. PWA v13.
- Toàn suite **295 PASS = server 238 (105 unit + 133 integration), client 57**, thêm 5 integration + 3 client so với bản #5 đầu. Thêm/sửa kiểm thử mixed redemption, cap fixed/%/rounding/0đ, flag legacy/default và tắt sau quote, rollback/replay/race/refund, snapshot cả hai; UI giữ lựa chọn, cap không trở về subtotal sau sửa điểm, cảnh báo exclusive và checkbox admin. Typecheck/lint/build PASS. Logs `.cache/promotion-stacking-{server,client,typecheck,lint,build}.log`.
- Hướng dẫn `docs/promotions-loyalty.md` đã cập nhật 11 ca tự test và ví dụ kết hợp, OpenAPI cập nhật flag và quote metadata. Các mô tả không cộng dồn trong lịch sử bên dưới là trạng thái cũ, không áp dụng lên voucher đã bật quyền kết hợp.
- Lightpanda cô lập PASS admin tạo mã có checkbox bật, báo giá giỏ hiển thị cap 25 điểm sau voucher10k/đơn60k, đặt cả hai ưu đãi tổng40k, hủy trả điểm+lượt, admin sửa tắt rồi guest bị từ chối mà giữ lựa chọn; migration apply/rerun và không JS exception/5xx. Harness/log `.cache/promotion-stacking-lightpanda-20261019.mts`, `.cache/promotion-stacking-lightpanda.log`. Chỉ DOM/hành vi; CSS/layout/in giấy/điện thoại thật vẫn chưa xác minh.
- Đã backup `.cache/maycafe-before-promotion-stacking-20261019.archive.gz`, build/recreate toàn stack local healthy; migrate exit0 (skip các migration cũ, bản kết hợp không thêm migration). Guest8080/Staff8081/Admin8082 vẫn chạy. Lightpanda read-only trực tiếp local PASS checkbox mới mặc định tắt trong form tạo (đóng không lưu), navigation/member/admin read APIs/health/isolation; không tạo voucher/thành viên/đơn/thu tiền hay sửa kho/QR thật. `.cache/promotion-stacking-{docker,local-start,local-smoke}.log`, `.cache/promotion-stacking-local-smoke-20261019.mjs`. Temporary Lightpanda/relay đã dừng/xóa; OpenAPI/whitespace PASS, chưa commit/push.

## Voucher và thành viên SĐT + mật khẩu (#5) — 19/10/2026

- User yêu cầu tiếp tục #5, hỏi các phương án không SMS, có lúc chọn nhân viên quản lý tại quầy rồi **đổi quyết định cuối cùng sang SĐT + mật khẩu**. Đã triển khai theo quyết định mới nhất; không có SMS/OTP/email provider, không coi SĐT là đã xác minh quyền sở hữu.
- Khách `/member`: tự đăng ký tên/SĐT/mật khẩu, đăng nhập/đăng xuất, xem số dư/sổ điểm phân trang, đổi mật khẩu và đăng nhập lại. Chuẩn hóa SĐT Việt Nam `+84…`/`0…`, bcrypt tối thiểu 8 ký tự/tối đa 72 byte; cookie HttpOnly `mc_member` 14 ngày, DB chỉ giữ hash token. Không thay quyền QR tại bàn. 6 lần sai khóa 15 phút + Redis limiter hiện có. Admin khóa/mở/reset và đổi mật khẩu thu hồi mọi phiên bằng authVersion; không có tự khôi phục mật khẩu khi chưa có kênh xác minh.
- Admin `/admin/vouchers`: FIXED/PERCENT, đơn tối thiểu, trần giảm, bắt đầu/kết thúc, tổng lượt, tùy chọn thành viên/lượt mỗi thành viên, sửa với expectedVersion và tạm dừng. Không đổi mã, không xóa lịch sử; list 200 chương trình mới nhất. `/admin/members`: tìm tên/SĐT, phân trang, xem lịch sử điểm, khóa/mở, đặt lại mật khẩu sau kiểm tra yêu cầu khách; không API tự sửa số dư.
- Quy tắc bản đầu do agent chọn cho BTL: **1 điểm / 10.000đ tổng sau giảm, chỉ khi PAID + SERVED; đổi 1 điểm = 1.000đ, tối đa 50% tiền món; mỗi đơn voucher hoặc điểm, không cộng dồn.** Đơn gắn thành viên đang đăng nhập lúc đặt; không truy lĩnh điểm cho đơn cũ. Điểm không hết hạn. Khóa thành viên không xóa nghĩa vụ tích/hoàn điểm của đơn đã đặt.
- Quote HMAC gắn thành viên + ưu đãi và tính lại khi đặt. Transaction chung đặt đơn/kho/giữ quota/trừ điểm/ledger/audit/outbox, write lock Member/Voucher chống double spend và tranh lượt cuối; Idempotency-Key replay không giữ/trừ hai lần. Voucher RESERVED→CONSUMED lúc PREPARING, hủy trước đó RELEASED. Đơn bỏ dở vẫn giữ lượt/điểm cho tới khi được hủy; chưa có tự hết hạn giữ.
- Ledger EARN/REDEEM/RETURN unique `(orderId,type)`; hủy/hoàn trước pha chế trả điểm và lượt đúng một lần. Không tích sớm ở thu tiền từng phần/đủ; VOID khoản thu không tạo điểm và giữ phần đã đổi tới lúc hủy/tiếp tục đơn. Giảm toàn bộ còn 0đ vẫn cần nhân viên xác nhận khoản thu 0đ; đã thêm hủy/hoàn 0đ trước pha chế.
- Order/Bill lưu subtotal và giảm voucher/điểm riêng, tổng thu là sau giảm. Khách, staff xem/in và admin in lại đều thấy dòng giảm; snapshot hóa đơn không bị sửa theo voucher hiện tại. Top món đổi nhãn tiền món trước ưu đãi, tổng báo cáo vẫn theo khoản thu thực.
- Thêm models Member/MemberSession/PointEntry/Voucher/VoucherUse, contracts `promotions.ts`, services/controllers tương ứng, API `/members/*`, `/admin/members*`, `/admin/vouchers*`, selection mới cho quote/order. Migration `20261019-002-promotions-members-indexes` chỉ tạo indexes; không reset/seed quán. Hướng dẫn và 10 ca tự test: `docs/promotions-loyalty.md`.
- Lint/typecheck/build PASS; toàn bộ **287 tests PASS = server 233 (105 unit + 128 integration), client 54**; riêng mới 19 integration + 6 client. Logs `.cache/promotion-{server,client}-final.log`, `.cache/promotion-{lint,typecheck}-final.log`, `.cache/promotion-build.log`. Mongo test cô lập, TEMP/TMP đặt D để tránh đầy ổ C như đợt #4.
- Lightpanda cô lập PASS tạo voucher, đăng ký thành viên, áp voucher/đặt đơn có member, thu đủ + SERVED tích điểm, đổi điểm/hủy/hiện hoàn điểm, admin lịch sử/khóa và thu hồi phiên; migration apply + rerun skip. `.cache/promotion-lightpanda-smoke-20261019.mts`, `.cache/promotion-lightpanda-smoke.log`. Lightpanda chỉ một context/page nên kiểm tuần tự; không dùng Chromium. Chưa xác minh CSS/layout/in giấy/điện thoại thật.
- **Đã cập nhật runtime local để user test**: khi kiểm tra phát hiện stack cũ đã dừng, đã bật Mongo/Redis, backup `.cache/maycafe-before-promotions-20261019.archive.gz`, build toàn stack, chạy migration mới rồi `docker compose -f compose.production.yaml up -d --wait`. Web, 4 API, 3 worker, Mongo/Redis healthy; migrate exit 0. Hash nguyên trạng của 12 collection nghiệp vụ trước/sau migration bằng nhau (Order/Payment/Bill/Table/TableSession/Product/Category/Topping/Ingredient/Recipe/StockMovement/User), không seed/reset. `.cache/promotion-business-{before,after}.json`, `.cache/promotion-{docker-build,migration,local-start}.log`.
- Guest `http://localhost:8080/member`, Admin `http://localhost:8082/admin/vouchers` và `/admin/members`, Staff 8081. Lightpanda smoke trực tiếp local PASS navigation/form login/đăng ký khách (không submit), nav/API voucher/thành viên admin, health 3 portal, guest member/me 200, chặn API admin từ Guest và member từ Internal 404; không JS exception/5xx. Không tạo thành viên/voucher/đơn/thu tiền/QR hay sửa kho thật; phiên admin smoke đã logout. `.cache/promotion-local-smoke-20261019.mjs`, `.cache/promotion-local-smoke.log`. Temporary Lightpanda/relay containers đã dừng và xóa; app vẫn chạy, tunnel chưa bật. OpenAPI YAML và whitespace PASS; thay đổi chưa commit/push.

## Kế hoạch mở rộng đủ 12 chức năng và thứ tự tiếp tục — 19/10/2026

- User muốn bổ sung **đủ cả 12 chức năng** trong danh sách đã trao đổi, triển khai từng đợt cho BTL nhóm 4 người. Giữ mã **#1–#12 theo danh sách gốc** để các yêu cầu như “làm #4” không bị hiểu thành thứ tự trong lộ trình.
- Thứ tự dưới đây là **lộ trình dự kiến đã đề xuất trong hội thoại**, ưu tiên nền tảng rồi tới các chức năng phụ thuộc. User đã yêu cầu triển khai #4 rồi #5 và #11; các chức năng còn lại chưa được yêu cầu triển khai cụ thể. Phạm vi các mục chưa làm là bản đầu dự kiến, cần làm rõ nghiệp vụ khi bắt đầu; không coi mọi lựa chọn thiết kế là đã được user duyệt.
- Kế hoạch mới thay thế ranh giới lịch sử “không mở rộng quản lý kho…” ở các mục cũ. Không tự mở rộng thêm ngoài 12 mục hoặc thay luồng tiền/dữ liệu đang sử dụng.

| Thứ tự triển khai | Mã gốc | Chức năng | Phạm vi dự kiến và trạng thái |
| --- | --- | --- | --- |
| 1 | #4 | Kho nguyên liệu, công thức và tự báo hết món | **Đã hoàn thành bản đầu, chạy local và nạp dữ liệu để user test.** 32 nguyên liệu, 22 công thức món + 6 topping; giữ khi đặt, trừ khi pha chế, trả giữ khi hủy; 262 tests đã đạt. Chờ feedback test; các giới hạn và bằng chứng ghi ở các mục bên dưới. |
| 2 | #5 | Voucher/Promotion và tích điểm thành viên theo SĐT | **Đã triển khai bản đầu theo SĐT + mật khẩu**, theo lựa chọn mới nhất của user (thay phương án nhân viên quản lý tại quầy). Voucher FIXED/PERCENT có điều kiện/hạn/lượt; khách đăng ký/đăng nhập, tích/đổi/hoàn và lịch sử điểm; admin quản lý voucher/thành viên. Xem mục #5 mới nhất và `docs/promotions-loyalty.md`. |
| 3 | #11 | Lịch ca, chấm công và hiệu suất nhân viên | **Đã hoàn thiện và chạy local**, 339 tests, Lightpanda cô lập + local PASS. Lịch/chấm công/correction/audit/KDS, coverage + gợi ý lịch sử có số mẫu, đối soát tiền riêng, copy tuần và CSV. Chưa xác minh trực quan/thiết bị thật. Xem `docs/workforce.md` (16 ca test) và mục #11 mới nhất. |
| 4 | #6 | Takeaway và Pre-order Pickup | **Đã hoàn thành và chạy local 20/10**, 373 tests PASS; thành viên/counter, hẹn giờ VN, thu trước pha, kho/ưu đãi/KDS, nhận/hủy/hoàn/no-show và Bill snapshot. Xem `docs/pickup.md`; còn kiểm trực quan/thiết bị thật. |
| 5 | #10 | Đặt bàn theo khung giờ | Chưa triển khai. Ngày/giờ/số người, chỉ hiện bàn đủ chỗ còn trống, chống trùng, check-in; quá hạn đến 15 phút đánh no-show và nhả giữ chỗ. Phải xử lý quan hệ với phiên khách đang ngồi và thời lượng đặt. |
| 6 | #1 | Tặng đồ uống cho bàn khác | Chưa triển khai. Chọn bàn trên sơ đồ, món trong menu và lời nhắn ẩn danh; bàn nhận được thông báo Nhận/Từ chối; tiền thuộc người gửi. Hướng bản đầu: nhận trước khi người gửi trả tiền, có hết hạn; tách nơi giao món khỏi bên trả tiền/hóa đơn, xác định quyền hủy/đánh giá. |
| 7 | #2 | Mini-game “Ai trả tiền?” | Chưa triển khai. Vòng quay đồng bộ cả bàn qua Socket.IO, server quyết định kết quả; lắc điện thoại bằng DeviceMotion trên thiết bị hỗ trợ, có nút thay thế. Chỉ giải trí, không tự thu/chuyển tiền hoặc đổi người thanh toán. |
| 8 | #3 | Jukebox | Chưa triển khai. Danh sách nhạc do Admin cung cấp, giới hạn vote theo phiên bàn, xếp hàng theo vote và màn hình quầy điều khiển phát. Nguồn nhạc/phát media cần kiểm tra thực tế. |
| 9 | #7 | Bot Telegram CSKH | Chưa triển khai. FAQ, giờ mở cửa/menu, tra cứu đơn sau liên kết/xác thực và chuyển yêu cầu cho nhân viên. Bản đầu không tự quyết định hủy/hoàn tiền. |
| 10 | #9 | Ảnh upload gắn với cốc cà phê | Chưa triển khai. Upload, giới hạn file, xem trước, gắn ảnh với món và màn hình in. **Cách hiểu tạm:** in ảnh thành tem dán cốc; user chưa xác nhận in trực tiếp lên cốc/bề mặt cà phê, chưa chốt yêu cầu phần cứng. |
| 11 | #8 | AI Barista freestyle ngoài menu, giá cố định | Chưa triển khai. Hướng dự kiến: phối từ nguyên liệu được duyệt và tồn kho #4, giới hạn định lượng/size/topping, giá do server cấu hình, lưu công thức vào đơn; không để AI tự tạo nguyên liệu/giá hoặc công thức không pha được. |
| 12 | #12 | Smart Insights và gợi ý bán kèm | Chưa triển khai. Giờ cao điểm, món bán chạy/lời, cặp món thường đi cùng, lời khuyên cho chủ và “Khách thường gọi kèm”. Bản đầu dùng thống kê/ngưỡng đủ dữ liệu; lợi nhuận cần bổ sung giá vốn (kho #4 hiện chưa có), không suy lợi nhuận từ doanh thu. |

- Các đợt tương ứng: **nền tảng #4 → #5 → #11; mở rộng bán hàng #6 → #10 → #1; trải nghiệm #2 → #3 → #7 → #9; khai thác nguyên liệu/dữ liệu #8 → #12**. Điểm tiếp tục mặc định là xử lý feedback #4/#5/#11 hoặc chạy bản #11 để user test; mục kế tiếp dự kiến **#6**, trừ khi user chọn mục khác; ghi kế hoạch không đồng nghĩa tự bắt đầu code mục tiếp theo.
- **Elasticsearch là ý tưởng ngoài 12 mục, chưa chốt triển khai.** User mới hỏi có phù hợp hơn search hiện tại hay không. Search hiện tại vẫn là TypeScript rule-based + fuzzy Levenshtein, parse Regex cho tiếng Việt/ngân sách/ràng buộc rồi xếp hạng trên catalog MongoDB; không gọi LLM trong `/menu/search`. Nếu sau này chuyển Elasticsearch, hướng đã đề xuất là giữ parser điều kiện, Elasticsearch tìm/xếp hạng, MongoDB kiểm lại giá/tồn, đồng bộ qua outbox và có fallback. Không ghi Elasticsearch là đang dùng hoặc đã được duyệt.

## Đã nạp dữ liệu kho theo yêu cầu user — 19/10/2026

- User yêu cầu tạo dữ liệu kho phù hợp dự án và đưa kịch bản để tự test. Đã nạp qua API Admin **32 nguyên liệu + 32 phiếu nhập tồn đầu + 28 công thức bật (22 món chưa archive, 6 topping)**. Tồn đủ cho mọi cấu hình đang bán, chưa có lượng giữ/cảnh báo sắp hết tại thời điểm nạp. Cà phê hạt 1000 g, sữa tươi 5000 ml, sả 200 g, trân châu trắng 1000 g, croissant 30 cái. Tồn không còn trống như bản ghi khởi chạy ngay bên dưới.
- Dataset `docs/data/inventory-demo.json`, mã `fantastic-inventory-demo-v1`, định lượng minh họa BTL theo món/size thật, trái cây sơ chế, trà/cold brew/topping bán thành phẩm và bánh thành phẩm theo phần/cái. Không hạch toán nước/đá/đường thêm theo lựa chọn; cần quán duyệt lại nếu dùng thực tế. Giữ nguyên tên/giá/ảnh/cờ bán/tùy chọn và liên kết topping; không khôi phục 3 món đã xóa. Tên cũ Cà phê Sữa Đá (Hết) vẫn giữ dù cờ bán đang bật.
- `scripts/setup-inventory-demo.mjs`: mặc định preview/validate, `--apply` mới ghi; credential chỉ qua `INVENTORY_ADMIN_PASSWORD` trong môi trường process, có thể chọn email/API URL. Chỉ tạo phần thiếu, phiếu tồn đầu key cố định; từ chối ghi đè công thức khác mẫu/nguyên liệu trùng mã nhưng khác tên/đơn vị. **Không reset tồn sau test.** Đã chạy lại apply: 0 nguyên liệu mới, 0 phiếu mới, 0 công thức mới; 32 phiếu replay, toàn bộ lượng tồn/giữ và version công thức không đổi.
- Backup trước nạp `.cache/maycafe-before-inventory-demo-20261019.archive.gz`. Hash trước/sau Order/Payment/Bill/Table/TableSession/Category bằng nhau; không tạo đơn/thu tiền hay cấp/đổi QR thử. API báo giá đọc 30 cấu hình món/size/topping đều đủ tồn và đúng giá. Không cần rebuild container vì chỉ thêm dữ liệu qua API; stack vẫn chạy healthy để user test.
- Tài liệu dữ liệu đầy đủ `docs/inventory-demo-data.md`; **12 kịch bản tự test có số lượng/kết quả/khôi phục** tại `docs/inventory-test-scenarios.md` (giữ/hủy, thu từng phần/pha chế, topping, hết size/món/topping, tranh phần cuối, chặn kiểm kê/ngừng khi còn giữ, hoàn tiền, snapshot công thức, version/phân quyền). Chưa tự thực hiện các giao dịch thủ công này trên dữ liệu quán.
- Logs/report `.cache/inventory-demo-{preview,apply,rerun}-20261019.log`, `.cache/inventory-demo-setup-report.json`, `.cache/inventory-demo-rerun-report-20261019.json`, `.cache/inventory-demo-recipe-verification-20261019.json`, `.cache/inventory-demo-business-{before,after}-20261019.json`. Không lưu password/token vào các file. Các thay đổi chưa commit/push.

## Đã chạy bản kho mới để user test — 19/10/2026

- Theo yêu cầu user, đã build/recreate và bật toàn stack `maycafe-production` bằng `docker compose -f compose.production.yaml up -d --build --wait`. MongoDB, Redis, 4 API, 3 worker và web healthy; migration exit 0, đã apply `20261019-001-inventory-indexes`, các migration cũ skip. Giữ stack chạy cho user test; tunnel public vẫn dừng.
- Guest `http://localhost:8080/menu`, Staff `http://localhost:8081`, Admin kho mới `http://localhost:8082/admin/inventory`. Hiện có 22 món và 6 topping chưa archive, **0 nguyên liệu và 0 công thức**; Admin tự nhập nguyên liệu/tồn/công thức, không tự tạo dữ liệu mẫu cho quán.
- Trước migration đã backup MongoDB tại `.cache/maycafe-before-inventory-20261019.archive.gz`. Không seed/reset, đổi secret hoặc khóa QR, sửa dữ liệu catalog/đơn/khoản thu/tồn kho. Các phiên đăng nhập smoke đã logout.
- Health cả 3 portal HTTP 200; Lightpanda PASS menu khách, đăng nhập Staff/Admin, trang tình trạng món có effectiveAvailable, navigation/trang kho và 3 tab, API inventory 200 và Guest gọi API Admin bị chặn 404. Không JS exception/HTTP 5xx; DOM/hành vi, chưa có bằng chứng CSS/layout trực quan. Đã dừng/xóa 2 container Lightpanda/relay tạm. Logs/harness `.cache/inventory-local-{start,smoke}-20261019.*`.

## Kho nguyên liệu và công thức (#4) — 19/10/2026

- User chọn bắt đầu chức năng #4 trong 12 ý tưởng mở rộng. Đã triển khai trong source **Admin → Kho & công thức** (`/admin/inventory`): tạo/sửa/ngừng dùng nguyên liệu (g/ml/đơn vị, ngưỡng sắp hết), nhập/xuất hao hụt/kiểm kê có lý do, sổ kho lọc/phân trang, công thức nền và công thức thay thế theo size; topping có công thức cộng thêm.
- Đặt đơn giữ nguyên liệu trong transaction, Order lưu snapshot định lượng; PREPARING giảm tồn thực và phần giữ, CANCELLED trả giữ qua cùng đường chuyển trạng thái (kể cả hủy sau hoàn tiền). Giá/thu từng phần/đủ không trừ thêm. Khóa ghi trên target catalog và cập nhật ingredient có điều kiện chống hai bàn tranh phần cuối; sửa công thức không đổi snapshot đơn cũ.
- Menu/featured/search/AI/validate cấu hình AI và báo giá/đặt món đều áp dụng tồn kho. Catalog cache riêng; tồn được đọc mới sau cache. Hết size/topping được chặn riêng; hết mọi size thì món rời danh sách bán. Nhập thêm tự khôi phục khi đủ nhưng không bật lại cờ ngừng bán thủ công. Staff → Hết món có nhãn thiếu nguyên liệu, realtime + polling 10 giây.
- Tồn lưu số nguyên 1/1000 đơn vị, API tối đa 3 số thập phân. Không cho xuất/kiểm kê dưới phần giữ hoặc ngừng nguyên liệu còn giữ. Nhập/xuất/kiểm kê dùng expectedVersion và idempotency key; UI giữ payload/key khi mất mạng/HTTP 5xx. Nguyên liệu/công thức có audit, ledger/outbox cùng transaction. API quản lý chỉ ADMIN, không đưa kho/công thức vào DTO đơn khách hay Bill.
- Migration mới `20261019-001-inventory-indexes` chỉ thêm index Ingredient/Recipe/StockMovement; đã drill apply rồi skip lần hai trên DB tạm, giữ số lượng business documents. Chưa chạy migration lên DB quán. Món/topping chưa bật công thức và đơn cũ chưa có snapshot tiếp tục luồng cũ, không tự suy đoán/backfill định lượng.
- Quy tắc vận hành: đơn chờ thanh toán giữ nguyên liệu đến khi hủy, **chưa có hết hạn giữ tự động**. Staff hủy đơn khách bỏ tại Bàn & phiên → Chờ thanh toán; đơn đã thu một phần cần hoàn tiền. Chưa có lô/hạn dùng, quy đổi đơn vị tự động, định lượng theo mức đường/đá hoặc giá vốn. Hướng dẫn và API: `docs/inventory.md`, `docs/api/openapi.yaml`.
- Kiểm chứng: lint/typecheck/build PASS; **262 tests PASS = 105 server unit + 109 integration + 48 client**, gồm 14 integration và 4 client mới. Lượt root test ban đầu lỗi do C chỉ còn khoảng 50 MB (MongoDB tạm không khởi động được) và một test client cũ timeout khi chạy song song; đã chuyển TEMP/TMP của process test sang `D:\codex-inventory-temp-20261019` và chạy lại từng nhóm đạt. Logs `.cache/inventory-{lint,typecheck,build,unit,integration,client}-20261019.log`.
- Lightpanda với frontend build và MongoDB replica set tạm PASS đăng nhập/navigation, thêm nguyên liệu, nhập tồn, bật công thức/size override, badge thiếu nguyên liệu Staff, ledger/khôi phục menu khi hủy; không JS exception/HTTP 5xx. Native selectOption của Lightpanda chưa đồng bộ React; harness dùng thay giá trị select và dispatch DOM change, kiểm payload/DB thật. **Native dropdown interaction và CSS/layout trực quan chưa được xác minh**. Log/harness `.cache/inventory-lightpanda-20261019.log`, `.cache/inventory-lightpanda-smoke-20261019.mts`.
- Không seed/reset, sửa đơn/khoản thu/catalog thật, cấp/xoay QR, sửa `.env` hoặc dùng AI provider thật. Stack `maycafe-production` đã dừng từ trước lượt này, được giữ nguyên; chưa build/recreate container production. Các thay đổi hiện chưa commit/push.

## Khởi chạy và kiểm tra local — 18/10/2026

- User yêu cầu chạy dự án và xem lỗi. Đã bật `maycafe-production` bằng `compose.production.yaml`; MongoDB, Redis, 4 API, 3 worker và web healthy; migration exit 0, các migration đã có được skip. Bốn API `/readyz` trả `ready`, cả MongoDB/Redis ready; không có restart trên API/worker tại thời điểm kiểm tra.
- Tunnel public vẫn dừng. `.env` chỉ đổi `PUBLIC_APP_URL` từ tunnel cũ sang `http://localhost:8080`, giữ các cấu hình/secret khác. Đã build/recreate web với cấu hình local. Guest `http://localhost:8080/menu`, Staff `http://localhost:8081`, Admin `http://localhost:8082`. Public 4G cần bật lại bằng script để lấy hostname mới.
- Source hiện tại: lint/typecheck/build PASS; **244 tests PASS** = 105 server unit, 95 integration, 44 client. Test integration dùng MongoMemoryReplSet riêng. Logs `.cache/startup-{lint,typecheck,tests,build}-20261018.log`; web build `.cache/startup-web-build-20261018.log`.
- Smoke bằng **Lightpanda** trên web mới PASS: menu/product selection, đăng nhập Staff/Admin, Bàn/KDS/tài khoản Staff, Bàn/Món/tài khoản Admin; API menu/health, current user, KDS chỉ PAID và route isolation đúng. Không thấy JS exception hoặc HTTP 5xx trong lượt smoke. Lightpanda chỉ xác minh DOM/hành vi, chưa chứng minh CSS/layout trực quan. Không kiểm AI provider live, camera/4G hay máy in thật. Log/harness `.cache/startup-smoke-20261018.*`. Hai container Lightpanda/relay tạm được dừng sau kiểm tra.
- `npm audit --json --fetch-retries=0 --fetch-timeout=20000` vẫn báo **15 vulnerabilities (2 moderate, 12 high, 1 critical)**; chưa nâng dependency. Report `.cache/startup-audit-bounded-20261018.json`.
- Không seed/reset, tạo đơn/khoản thu thử, sửa catalog hoặc cấp/xoay khóa QR. Đã logout các phiên Staff/Admin thử nghiệm; giữ stack local chạy để user xem. User yêu cầu commit/push bản ghi kiểm tra này lên `main`; `.env`, `apikey.txt` và `.cache/` vẫn bị Git ignore.

## Trạng thái mới nhất — đã bật lại local và public, 16/10/2026

- Theo yêu cầu user, đã bật lại toàn bộ stack `maycafe-production`; 4 API, 3 worker, web, MongoDB và Redis healthy. Guest `http://localhost:8080`, Staff `http://localhost:8081`, Admin `http://localhost:8082`. Mục tắt web ngày 15/10 bên dưới là lịch sử.
- Tunnel `fantastic-public-tunnel` đang chạy tại `https://newspaper-horses-gtk-checkout.trycloudflare.com`; đã đồng bộ `PUBLIC_APP_URL` và giữ cookie Guest Secure qua `compose.public.yaml`. Public menu, products và health trả HTTP 200. User tự chọn bàn và mở màn hình QR; chưa xác nhận camera/4G thật.
- User đã sửa cấu hình AI trong `.env`; đã recreate 4 API và 3 worker bằng cả hai file Compose, xác nhận các biến AI runtime khớp cấu hình hiện tại và `AI_MODE=live`. Chưa gọi thử provider với cấu hình mới; không coi AI live đã đạt chỉ vì dịch vụ healthy.
- Không seed/reset, không tạo đơn/khoản thu thử, không xoay khóa QR và không in secret. `.env`, `apikey.txt` và `.cache/` tiếp tục bị Git ignore.
- Trước checkpoint Git theo yêu cầu user: lint/typecheck/build PASS; **200 tests PASS** (71 server unit, 85 integration, 44 client). Kiểm tra secret và whitespace của phần staged PASS. Logs `.cache/git-push-{lint,typecheck,test,build}.log`.
- `npm audit --audit-level=high` ngày 16/10 báo **15 vulnerabilities (2 moderate, 12 high, 1 critical)** với dependency hiện có; package manifests/lockfile không thay đổi trong checkpoint này. CI có bước audit nên có thể thất bại. Chưa nâng dependency; không dùng `npm audit fix --force`. Log `.cache/git-push-audit.log`; các ghi chú audit 0 ở mục lịch sử không còn phản ánh kết quả mới.

## Trạng thái khi kết thúc — đã tắt web, 15/10/2026

- Theo yêu cầu user, đã tắt container public `fantastic-public-tunnel` và toàn bộ stack `maycafe-production` (web, 4 API, 3 worker, MongoDB, Redis; migration cũng đã dừng). Chỉ stop, giữ container/volume/dữ liệu và mọi thay đổi code; không seed/reset, không commit/push.
- `.env` đã phục hồi `PUBLIC_APP_URL=http://localhost:8080` từ `.cache/public-original-url.txt`; không sửa secret. Link `https://officials-emissions-ryan-vinyl.trycloudflare.com` là link demo đã dùng và hiện không còn phục vụ ứng dụng.
- Mở lại local: `docker compose -f compose.production.yaml up -d --wait`. Ba portal Guest 8080, Staff 8081, Admin 8082. Mở lại public: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/public-web.ps1`; script lấy URL tunnel mới và đồng bộ QR. User tự chọn bàn ở Nhân viên/Admin; không tự cấp lại khóa hoặc tạo phiên/đơn thử trên dữ liệu quán.
- Trạng thái tính năng đã lưu: bấm tên Admin Mây/nhân viên để mở profile, đổi mật khẩu/đăng xuất; menu giữ Nhân viên, có xóa nhân viên; topping xóa/khôi phục; mã khoản thu ở Chi tiết. Runtime portal meta và cookie Guest Secure cho public HTTPS đã triển khai.
- Kết quả trước khi tắt: toàn bộ suite 198 PASS (71 server unit, 85 integration, 42 client); sau thay đổi public, client 44 PASS, web Docker build/TypeScript và lint PASS, public HTTPS/menu/ảnh/secure context/WebSocket và chặn route nội bộ PASS. Camera/4G thực tế chưa được user xác nhận. Chi tiết/log nằm trong các mục bên dưới.

## Public HTTPS cho điện thoại quét QR — 15/10/2026

- User yêu cầu public web để điện thoại quét; user tự chọn bàn trong Nhân viên/Admin. Đã mở **cổng Guest 8080** qua Cloudflare Quick Tunnel, container `fantastic-public-tunnel` trên network `maycafe-production_default`; URL đã dùng `https://officials-emissions-ryan-vinyl.trycloudflare.com` (đã tắt theo yêu cầu; sẽ đổi khi tunnel khởi động lại). Không mở public Staff/Admin/Mongo/Redis.
- Script `scripts/public-web.ps1` khởi động/tái sử dụng tunnel, lấy URL của lần chạy hiện tại qua docker logs --since StartedAt, cập nhật PUBLIC_APP_URL trong `.env`, giữ secret và dữ liệu; URL lưu `.cache/public-url.txt`, URL cũ lưu `.cache/public-original-url.txt`. Chạy `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/public-web.ps1`; dừng/khôi phục local bằng cùng lệnh thêm `-Stop`. Dùng image đã build, không tự seed/reset.
- `compose.public.yaml` đặt COOKIE_SECURE=true riêng 2 Guest APIs; Internal tiếp tục false cho local HTTP. Cả 4 APIs/worker nhận PUBLIC_APP_URL mới nên vé QR và link /display do Staff/Admin cấp dùng HTTPS public. SERVER_ORIGIN local giữ để màn hình localhost cũng lấy QR mới; không xoay khóa QR hoặc chọn/thay đổi bàn thay user.
- Nginx inject meta fantastic-cafe-portal ở server scope (kế thừa cả location=/index.html khi SPA redirect); client getPortalMode đọc meta để nhận đúng Guest trên hostname tunnel bất kỳ. Tránh rebuild frontend mỗi lần hostname đổi; route/API nội bộ vẫn bị Nginx/backend chặn. Cache PWA v10.
- Web Docker build/TypeScript và client lint PASS; client **44 tests PASS** (2 test nhận diện portal mới). Nginx -t PASS. Public HTTPS/menu đọc được, browser mobile kiểm secure context, menu, API origin được chấp nhận, WebSocket handshake thành công; Staff/Admin route/API từ public trả 404, local portal vẫn chạy. Không tạo phiên/đơn/khoản thu; chưa kiểm camera/4G thực tế trên điện thoại của user. Logs `.cache/public-{web-build,client-tests,lint,start,production}.log`, ảnh `.cache/public-browser/`.
- Đây là URL demo tạm thời: giữ PC, Docker và tunnel bật. Tunnel không tự restart để tránh đổi URL mà app chưa đồng bộ; sau khi bật lại dùng script để cập nhật URL và mở lại màn hình QR. Chưa có hosting cloud luôn bật/domain cố định.

## Tài khoản, xóa topping và khoản thu gọn — 15/10/2026

- Lối vào **Tài khoản của tôi** là bấm tên người dùng ở cuối sidebar (Admin Mây hoặc nhân viên); mobile bấm tên dưới thương hiệu. Route `/staff/account`, `/admin/account` xem tên/email/vai trò, sửa tên, đổi mật khẩu bằng mật khẩu hiện tại và đăng xuất; đổi mật khẩu cần đăng nhập lại. Menu Admin giữ **Nhân viên**, menu Staff giữ các mục nghiệp vụ; không thêm mục Tài khoản của tôi/Quản lý tài khoản vào navigation theo yêu cầu đã làm rõ của user.
- Mục **Nhân viên** giữ tạo/sửa/khóa/mở/đặt lại mật khẩu, thêm **Xóa** có xác nhận tên. DELETE `/admin/users/:id` chỉ ADMIN xóa STAFF, đánh isDeleted=true/isActive=false, tăng authVersion, revoke refresh và ghi audit trong transaction. List bỏ nhân viên đã xóa; PATCH không mở lại người đã xóa. Bản ghi User còn để giữ tên/người thu trong lịch sử ca làm, đơn và khoản thu.
- `accountService` dùng Zod strict, chỉ cho cập nhật trường hợp lệ; chặn tự khóa/hạ quyền. Transaction khóa actor và target, chống hai admin đồng thời hạ quyền nhau. `authVersion` User/RefreshSession mặc định 0 để tương thích dữ liệu/token cũ; đổi mật khẩu/quyền/trạng thái tăng version và revoke refresh trong cùng transaction. HTTP kiểm người dùng active/quyền/version tại mỗi request; socket kiểm khi vào và mỗi 10 giây. Không trả hash mật khẩu; audit không lưu mật khẩu.
- Admin Topping thêm **Xóa** có xác nhận, nhóm **Topping đã xóa** và **Khôi phục**; `DELETE /admin/toppings/:id` xóa mềm qua catalogMutationService nên có audit/outbox/cache invalidation. Giữ liên kết topping trên món và snapshot đơn cũ; menu/cấu hình AI/giỏ cũ chặn topping đã xóa; phục hồi dùng PATCH isArchived=false.
- Khoản thu ở cả hai portal rút gọn tiêu đề/hướng dẫn; mã khoản thu và mã thay thế nằm trong **Chi tiết**, hướng dẫn trong **Quy định điều chỉnh**. Danh sách giữ bàn, mã đơn, số tiền, phương thức, thời gian, trạng thái; lịch sử điều chỉnh có bàn/đơn/số tiền để đối chiếu. PWA cache v9.
- Lint/typecheck/build PASS. Toàn bộ test **198 PASS** = server unit 71, integration 85, client 42. Account integration có 9 tests, thêm 1 topping lifecycle integration và 5 client tests; DB test cô lập, không seed/reset dữ liệu quán. Logs `.cache/account-{tests,lint,typecheck,build}.log`.

- Đã build/recreate toàn stack production-local; Mongo/Redis, 4 API, 3 workers và web healthy, migrate exit 0. Chromium trực tiếp PASS 18 màn hình ở 375/768/1440: tài khoản Admin/Staff, sửa tài khoản/xác nhận xóa topping, khoản thu gọn; không tràn ngang/lỗi JS. Hủy mọi hộp sửa/xóa; users và dữ liệu topping nghiệp vụ trước/sau bằng nhau (bỏ qua `_id` mặc định được Mongoose sinh cho ingredientMetadata chưa lưu). Không seed/reset hay thay đổi giao dịch quán. Logs `.cache/account-{docker,production}.log`, ảnh `.cache/account-browser/`.

- Bản theo yêu cầu làm rõ đã build/recreate production-local và toàn stack healthy. Typecheck/lint/build PASS; **198 tests PASS**. Chromium PASS bấm tên mở profile, form đổi mật khẩu và đăng xuất về login (route bảo vệ và refresh 401 sau logout) cho Admin/Staff; navigation giữ Nhân viên, không có mục tài khoản mới. Xác nhận xóa nhân viên được hủy ở 375/768/1440, users trước/sau bằng nhau; không tràn ngang/page error. Ảnh `.cache/profile-browser/`, logs `.cache/profile-{tests,lint,typecheck,build,docker,production}.log`.

## Xóa catalog và ẩn danh mục xuyên suốt — 13/10/2026

- User yêu cầu bổ sung xóa món/danh mục và hỏi ý nghĩa mã khoản thu. Trang Món có **Xóa** kèm xác nhận tên, dùng API DELETE xóa mềm `isArchived`; mục **Món đã xóa** có Khôi phục. Giữ đơn/khoản thu/hóa đơn và doanh thu cũ. Trang Danh mục có số món tính cả archive và xác nhận xóa: danh mục trống xóa được; còn món phải chọn nơi nhận, chuyển toàn bộ món rồi xóa danh mục nguồn trong cùng transaction.
- `DELETE /admin/categories/:id`, body `{reassignTo?}` chỉ ADMIN. Chặn `CATEGORY_NOT_EMPTY`, nhận trùng nguồn/ID sai/không còn. `catalogMutationService` ghi cùng Category.version với create/update product để tránh tạo/chuyển món vào danh mục bị xóa khi thao tác đồng thời; audit `category.productsMoved`/`category.deleted`, outbox realtime và invalidate cache ngay sau commit. Không thêm schema/index/migration mới.
- Public product repository và featured lọc Category.isActive; menu, search, AI fallback/live cùng nguồn. PriceOrderItems kiểm danh mục trong session để từ chối giỏ cũ; API cấu hình AI/detail cũng kiểm active. Guest realtime invalidate cả menu và menu-search; AISheet loại gợi ý cũ không còn trong catalog. Ẩn danh mục không sửa isArchived/isAvailable của món; hiện lại khôi phục khả năng xem/bán theo trạng thái món.
- Form sửa món điền đúng categoryId, giữ ID variant/đường/đá/topping/ingredientMetadata khi đổi danh mục; trước đó form khởi tạo category rỗng và ghi đè các trường tùy chọn. PWA cache v7. Hướng dẫn `docs/catalog-lifecycle.md`; OpenAPI có DELETE category. `docs/payment-safeguards.md` giải thích Payment._id là ID từng lần thu, khác mã đơn/mã ngân hàng và khóa idempotency.
- Typecheck/lint/build PASS; unit server **71**, integration **75** (8 test lifecycle mới), client **37** = **183** PASS. Integration kiểm phân quyền, giữ paid order/payment snapshot, hide/show menu/search/AI/old cart, count archive, reassignment/rollback và delete-vs-create không orphan. Chromium/API/Mongo cô lập PASS xác nhận/hủy, xóa/khôi phục món, đổi danh mục giữ cấu hình, hide/show realtime, chuyển+xóa và xóa danh mục trống; 3 viewport 375/768/1440 không tràn/page error. Logs/ảnh `.cache/catalog-*`.
- Đã build/recreate toàn API/workers/web production-local, mọi service healthy; không seed/reset hay sửa catalog/đơn/khoản thu thật. Mở Admin 8082, Ctrl+F5. Các thay đổi sau Git checkpoint `9c27792` vẫn ở working tree, chưa push.
- Smoke production read-only PASS hộp xác nhận xóa ở 3 viewport, productCount đúng, menu khách và 3 portal healthy; hủy hộp thoại, catalog trước/sau bằng nhau. Log/ảnh `.cache/catalog-production*`.

## Đồng bộ các thành phần khách với nền thực đơn — 13/10/2026

- Theo ảnh/user feedback, cửa sổ AI sáng cũ lệch với thực đơn nền ảnh tối. Đổi token `:root.theme-guest` sang nền `#101D18`, card `#1B2B23`, chữ `#F6F3EB`, primary/accent vàng `#F4A21D`; muted/success/danger đủ tương phản trên nền tối. `styles/guest-surfaces.css` áp cho sheet, overlay, header/đóng, dock, phiếu giỏ/đơn và trang vào bàn; theme ở html nên Radix portals cũng kế thừa. Staff/Admin giữ theme nền kem.
- AISheet có icon/header, nhóm ngân sách và tùy chọn, nhãn mô tả, preset hai cột có trạng thái chọn, spinner lúc chờ, thẻ gợi ý với MenuPhoto cache/error fallback và giá/nút hướng đến cấu hình. Kết quả mới cuộn vào vùng xem; header sheet AI/chọn món giữ nút đóng khi cuộn. Giữ nội dung menu/preset/API/fallback hiện có và bước xác thực cấu hình AI trước thêm giỏ.
- Tùy chỉnh size/đường/đá/topping, nút/checkbox/input, bộ lọc, giỏ nổi, điều hướng, đơn, hủy và đánh giá dùng cùng màu. Cart dùng ảnh local qua MenuPhoto và chiều rộng đọc 3xl. Hóa đơn in chuyển token về nền trắng/chữ đậm (kể cả chữ phụ), QR vẫn ảnh đen trắng trên trắng. Meta/PWA màu nền đồng bộ, cache `fantastic-cafe-shell-v6`.
- Client typecheck/lint/build và 37 tests PASS. Chromium/API/Mongo replica set cô lập PASS AI thực sự trả gợi ý fallback từ catalog → mở món, tùy chỉnh/giỏ/đặt đơn 35k → thu 10k + 25k → KDS phục vụ → gửi đánh giá → đóng phiên/hóa đơn. Kiểm ba viewport 375/768/1440 cho các cửa sổ/giỏ/đơn/receipt, nút đóng trong vùng xem, không tràn ngang/page error; in giấy trắng và chữ phụ đủ đậm. Không tạo dữ liệu thử trên DB quán.
- Đã build/recreate web local; toàn stack healthy. Smoke trực tiếp production PASS AI sheet 3 kích thước, Escape, ảnh/thẻ/chọn món/bộ lọc/vào bàn và theme Staff/Admin; chỉ đọc. Artifacts/log `.cache/guest-surfaces-*`. Xem `http://localhost:8080/menu`, Ctrl+F5. Các thay đổi sau checkpoint `9c27792` vẫn chưa commit/push.

## Checkpoint Git và thực đơn dạng ảnh nền — 13/10/2026

- Theo yêu cầu, đã commit/push toàn bộ code hiện tại trước khi sửa giao diện mới: `9c27792` trên `origin/main` (`longdxam/QR-Order-Pay`), commit `feat: secure prepaid ordering and rebrand Fantastic cafe`. Workspace sạch tại checkpoint; code thực đơn dưới đây được làm sau checkpoint.
- Trang khách `/menu` nay dùng `MenuShowcase.tsx` + `menu-showcase.css`: ảnh món phủ nền, lớp gradient, nội dung tên/mô tả/giá ở trái và carousel thẻ món ở phải. Bấm thẻ/next/previous đổi preview, không mở modal hoặc gửi đơn. **Chọn món** mới mở ProductDetailModal để size/đường/đá/topping, thêm giỏ và đặt như trước.
- MenuPage giữ API menu, tìm kiếm câu tự nhiên, bộ lọc ngân sách/caffeine/sữa, danh mục và AI Barista. Chỉ route `/menu` bật `guest-showcase` trong GuestLayout để header trong suốt/phủ ảnh và main toàn chiều rộng; trang giỏ/đơn/hóa đơn vẫn dùng layout cũ. Mobile xếp mô tả trên, thẻ vuốt ngang dưới, giữ dock và giỏ nổi. Có trạng thái tải/rỗng/lỗi, tạm hết, focus keyboard và reduced motion.
- Ảnh lấy từ Product.image thật trong catalog đang chạy; cache 18 nguồn hợp lệ tại `client/public/menu-images/` (có SOURCES.md), ánh xạ theo URL trong `menu-image-cache.json`. Hai URL không phải ảnh (Drive home và nguồn lỗi) dùng nền/icon dự phòng; không thay ảnh hoặc nội dung database. MenuPhoto dùng chung cho preview/card/modal, hỗ trợ ảnh mới không có cache và onError. Cache PWA tăng `fantastic-cafe-shell-v5`.
- Typecheck/lint/build client PASS; client **37/37** tests, thêm 3 kiểm tra chọn-preview/tùy chỉnh, lọc và chặn chọn món tạm hết. Chromium/API/Mongo replica set cô lập PASS 5 viewport, đổi ảnh/mô tả/giá, arrows/danh mục/tìm kiếm/rỗng/ảnh lỗi/AI, mở cấu hình/thêm giỏ và đặt đơn thật `AWAITING_PAYMENT / UNPAID` 35k; không dùng dữ liệu quán để đặt thử. Artifacts `.cache/showcase-*`.
- Đã build/recreate web production-local, web và toàn stack healthy. Smoke trên web đã triển khai PASS 3 kích thước, ảnh local tải thật, đổi món/mô tả và mở cấu hình; Staff/Admin không nhận theme menu. Không tạo phiên/đơn/khoản thu trên DB quán. Mở `http://localhost:8080/menu`, Ctrl+F5. Bản giao diện mới còn ở working tree, chưa push sau checkpoint `9c27792`.

## Đổi tên hiển thị và font — 13/10/2026

- Người dùng yêu cầu đổi tên thành **Fantastic cafe**, đổi kiểu chữ cho giao diện. Tên hiển thị được cập nhật trên Khách/Staff/Admin, đăng nhập, QR, hóa đơn/in, lời cảm ơn, document title/meta/PWA và tiêu đề CSV. README và design-context dùng tên mới; các ghi chú lịch sử phía dưới còn tên cũ.
- Cả ba portal dùng **Be Vietnam Pro**, WOFF2 400/500/600/700/800, có bộ ký tự tiếng Việt, Latin và Latin extended. Font và OFL được lưu tại `client/public/fonts/`, không phụ thuộc Google Fonts khi mở app. Service worker `fantastic-cafe-shell-v4` precache cả font/CSS và đổi phiên bản cache.
- CSS tiêu đề bỏ font-stretch và weight 650 của Bricolage, chuyển 700/600 và line-height 1.12 cho dấu tiếng Việt. Shared sidebar giảm tên brand xuống 18px, cho phép xuống dòng trong khung hiện tại.
- Các định danh kỹ thuật/database, tài khoản demo và tên món trong menu vẫn là dữ liệu hiện hữu. Không reset/seed khi đổi thương hiệu hiển thị.
- Build/lint PASS. Đã build/recreate toàn stack local và kiểm tra **54 màn hình** trên ba portal tại 375/768/1440: tên Fantastic cafe, font Be Vietnam Pro tải từ local, không tràn ngang, không lỗi JS. PWA/manifest dùng tên mới; font tiếng Việt được cache và dùng được khi offline. Các dịch vụ healthy. Log/ảnh `.cache/fantastic-*`; Ctrl+F5 để tải bundle mới.

## Bảo vệ thanh toán và điều chỉnh khoản thu — 13/10/2026

- Theo yêu cầu bổ sung: thu từng phần (`Order.paidAmount`, DTO `balanceDue`), chỉ đủ tiền mới vào KDS; khách đã trả một phần phải yêu cầu nhân viên hoàn/hủy. Hoàn trước pha chế xử lý tất cả khoản thu còn hiệu lực của một đơn trong cùng transaction.
- `paymentClaimService.ts`: khóa thu ở cấp phiên bàn trong 120 giây, client gia hạn 30 giây, token hash gắn tài khoản/cửa sổ. Thu từng đơn và thu gộp cũ bắt buộc header `X-Payment-Claim`. Xác nhận tiền/hoàn/thu gộp thành công trả quyền ngay ở server trong transaction, không phụ thuộc cleanup của trình duyệt. Bàn giữ quyền chặn chuyển bàn/đóng phiên/chốt ca; hủy đơn chưa thu cũng được bảo vệ.
- `PaymentCorrection` + `paymentCorrectionService.ts`: VOID (đảo ghi nhận nhầm), METHOD (đổi phương thức), TRANSFER (chuyển sang đơn đúng); giữ nguyên amount/method/paidAt/người thu gốc, ghi trường đảo và khoản thay thế liên kết `replacesPaymentId`. Nhân viên lập lý do, ADMIN khác duyệt/từ chối; expectedVersion + unique pending index chống hai người duyệt/ghi trùng. Đơn nguồn/đích đang chờ duyệt bị giữ các thao tác tài chính/công đoạn/đóng phiên.
- Hai portal có trang **Khoản thu**: `/staff/payments`, `/admin/payments`, dùng `PaymentAccounting.tsx`. Bàn/đơn/số tiền/phương thức và lý do hiện khi duyệt. Sửa phương thức sau đóng phiên được lưu riêng; Bill snapshot giữ nguyên. VOID/TRANSFER chỉ trước pha chế và phiên còn hoạt động; khoản cũ gộp nhiều đơn chưa được tự chia.
- `paymentAnalyticsService.ts` tính grossCollected, totalRefunded, adjustmentAmount, thực thu ròng và ngày/giờ theo paidAt/refundedAt, có thể âm ngày chỉ hoàn tiền. CSV cùng nguồn. Top món vẫn theo ngày tạo đơn đã thanh toán, UI ghi rõ. Ca tách hoàn thực tế và đảo ghi nhận, tính số còn thiếu theo số thực thu; chênh lệch phải có lý do, chưa có bước quản lý duyệt chênh lệch riêng.
- Client giữ payload/idempotency key khi mất kết nối để thử lại, khóa sửa tiền/phương thức khi chưa rõ kết quả. Các API không tự chuyển tiền hoặc xác minh ngân hàng.
- Migration mới `20261013-001-payment-correction-indexes`: index unique pending và lookup Payment; thêm schema, không backfill/sửa khoản thu cũ hay reset DB. Dữ liệu Order cũ đọc tương thích paidAmount null.
- Hướng dẫn đầy đủ: `docs/payment-safeguards.md`; OpenAPI đã thêm claim, lịch sử khoản thu, yêu cầu và quyết định điều chỉnh.
- Kiểm chứng trước cập nhật runtime: unit 71, client 34, integration 67 đều PASS; typecheck/lint/build PASS. Chromium với Mongo replica set cô lập PASS thu 10k + 25k, hiển thị dư nợ khách, sửa 10k tiền mặt thành chuyển khoản có quản lý duyệt, KDS và đóng phiên; thực thu ròng giữ 35k. Sáu màn hình khoản thu Staff/Admin tại 375/768/1440 không tràn, không page error. Log/ảnh `.cache/payment-*`. Trạng thái chạy cuối cùng ghi tại `docs/test-report.md`.
- Đã cập nhật production-local toàn bộ API/workers/web, migration exit 0 và mọi service healthy. Backup trước cập nhật: `.cache/maycafe-before-payment-safeguards.archive`. Hai trang Khoản thu, login, báo cáo và phân quyền production đã smoke PASS bằng thao tác đọc, không tạo/sửa khoản thu/đơn thật. Ctrl+F5 Staff/Admin/Guest để nhận bundle mới. Chốt chặn cuối bảo vệ cả mở lại phiên CHECKOUT và duyệt hủy khi không còn tiền đã thu; integration 67 và server typecheck/lint kiểm lại PASS.

## Thiết kế theo repo cho cả ba giao diện — 13/10/2026

- Người dùng yêu cầu đọc README/logic/schema/style trước khi thiết kế, dùng nội dung thật và kế thừa nhận diện; đã xác nhận áp dụng cho cả Khách, Nhân viên và Quản trị.
- Tạo `docs/design-context.md`: mục đích hệ thống, thứ bậc QR/catalog/pipeline, file quan trọng, token màu/font chính xác, nhãn thật, các mục tiêu và điều kiện nghiệp vụ cần giữ. Đã đọc cả public menu và chụp các portal trước thay đổi; không dùng số liệu/nội dung marketing giả.
- Khách: trang vào bàn rõ QR/link, bỏ ví dụ token tĩnh và hướng dẫn seed lỗi thời; menu nhấn mạnh danh mục/món và ảnh thật, AI là hỗ trợ chọn món; header có điều hướng desktop, dock tiếp tục dùng trên mobile. Đơn/hóa đơn giới hạn chiều rộng để đọc; giữ phiếu mép răng cưa, đánh giá từng đơn và luồng gọi thêm.
- Staff/Admin: `client/src/components/layout/InternalShell.tsx` dùng chung sidebar desktop, navigation cuộn trên mobile, tài khoản/đăng xuất và trạng thái thật. Kế thừa nền kem/primary xanh/Playfair + Inter; Guest tiếp tục dùng nền xanh nhạt/Bricolage. Card/input/border thống nhất qua token hiện có; warning ánh xạ sang accent đã có.
- Staff: badge chờ tiền của Bàn & phiên lấy API thật, KDS có lối vào hàng chờ thanh toán và các cột công đoạn rõ; điều chỉnh thẻ bàn/nhận tiền. Nút chuyển công đoạn hiển thị tên trạng thái tiếp theo, aria-label giữ đầy đủ “Chuyển sang …”. Nút thu gộp legacy chỉ hiện khi có đơn legacy đã phục vụ/chưa thu.
- Admin: Bàn & QR/cấu hình màn hình và quản lý menu được ưu tiên trong điều hướng; Dashboard đặt các lối quản lý thật trước số liệu. Bỏ report job chỉ để hiện số đơn trong header; bộ lọc/báo cáo chính vẫn hoạt động. Trang bàn, danh sách món, chart và table kế thừa hệ nhận diện.
- Kiểm chứng: client typecheck/lint/build PASS, client 32/32 test PASS. Chromium + Mongo cô lập với catalog đọc từ API thật PASS QR → đặt/thu tiền/KDS → đánh giá A → gọi thêm/đánh giá B → đóng/in/receipt; menu và Staff kiểm tra 390/768/1440. Browser trên production-local PASS 45 tổ hợp route/viewport (375/768/1440) của 14 trang Staff/Admin và trang vào bàn; không tràn ngang/page error, login/logout đúng. Không tạo/sửa dữ liệu nghiệp vụ trong audit production.
- Đã build/recreate riêng web; toàn stack vẫn healthy. Logs `.cache/design-*.log`; ảnh trước/sau `.cache/design-before/`, `.cache/design-after/`, ảnh luồng khách/staff `.cache/design-runtime/`. Ctrl+F5 các portal để thấy giao diện mới.

## Đánh giá từng đơn khi phiên vẫn mở — 13/10/2026

- Theo yêu cầu người dùng, trang **Đơn của bạn** hiện nút **Đánh giá đơn** cho đơn `SERVED + PAID` chưa đánh giá. Hộp chọn 1–5 sao và nhận xét dùng chung component `client/src/features/guest/OrderReview.tsx` với trang hóa đơn. Gửi xong hiển thị số sao/nhận xét, không đóng phiên; khách gọi thêm đơn mới và đánh giá riêng đơn đó.
- GET `/orders/mine` và `/orders/:id` nay trả `review: { rating, comment, createdAt } | null`; serializer và contracts lọc field đánh giá. List truy vấn các đánh giá của đúng participant/phiên một lần. Tải lại trang vẫn thấy đánh giá đã gửi.
- POST `/orders/:id/review` đã có từ trước, nay được dùng trên giao diện khi phiên OPEN/CHECKOUT. Service kiểm cả participant và tableSessionId, yêu cầu SERVED/PAID; unique orderId vẫn ngăn gửi trùng. Race duplicate key được chuyển thành 409, không trả 500.
- Trang receipt sau đóng phiên giữ đánh giá đã gửi và cho gửi những đánh giá còn thiếu qua `/receipts/orders/:id/review`. Review không sửa Bill snapshot, quyền gọi món hoặc trạng thái phiên.
- Kiểm chứng source: lint/typecheck/build PASS; server unit 71/71, client 32/32, integration 55/55 (158 tests). Chromium dùng API và Mongo replica set cô lập PASS đánh giá A khi OPEN → gọi thêm và đánh giá B khi OPEN → reload giữ cả hai → đóng phiên và receipt giữ cả hai, không có page error. Log `.cache/order-reviews-*.log`, ảnh `.cache/order-reviews-browser/`.
- Đã build và cập nhật toàn bộ production-local bằng Compose, dùng `.env` hiện có; tất cả API/web/worker/Mongo/Redis healthy và migrate exit 0. Ba portal/login Staff/API chờ tiền/KDS/route isolation smoke PASS, bundle OrderReview mới đang phục vụ. Không seed/reset dữ liệu hoặc tạo review thử trên dữ liệu quán. Khách Ctrl+F5 trang Đơn của bạn để dùng UI mới.

## Link vào bàn trên màn hình QR — 13/10/2026

- Bổ sung **Mở link vào bàn**, **Sao chép link** và ô link chỉ đọc dưới QR tại `/display#…`, để test/gọi món trên cùng máy. Link lấy đúng `data.url` của QR ngắn hạn, tự đổi và được ẩn khi QR hết hạn/mất mạng; không dùng khóa cấu hình màn hình làm link khách.
- Clipboard lỗi/không hỗ trợ thì chọn sẵn ô link và hướng dẫn sao chép thủ công. Mở link dùng tab mới để giữ màn hình QR hoạt động.
- Client lint và 28/28 test PASS; test QR hiện kiểm tra link khách đúng và bị ẩn khi hết hạn. Docker web đã build/recreate, healthy, bundle mới được xác nhận đang phục vụ và ba portal trả 200. Hướng dẫn `docs/qr-prepayment.md` đã cập nhật.
- Khi khởi chạy lại dự án cần bật toàn stack bằng `docker compose -f compose.production.yaml up -d --wait`; chỉ restart web khi API/Mongo/Redis đang dừng sẽ khiến trang vẫn mở nhưng login trả 502. Đã bật lại toàn stack và kiểm tra login Staff/Admin HTTP 200 ngày 13/10/2026.

## Luồng hiện tại — QR động và thanh toán trước (12/10/2026)

Mục này thay thế mô tả QR tĩnh/thu tiền cuối phiên trong các ghi chú lịch sử bên dưới.

- Yêu cầu đã triển khai: màn hình tại bàn đổi QR mỗi 60 giây → khách quét mã còn hạn (Wi-Fi/4G) → đơn `AWAITING_PAYMENT / UNPAID` → nhân viên xác nhận tiền từng đơn → `PENDING / PAID` mới xuất hiện tại KDS → khách gọi thêm trả tiếp → đóng phiên mới thu hồi quyền gọi món.
- Staff `/staff/tables` và Admin quản lý bàn có nút **Cấu hình màn hình QR**. Liên kết `/display#…` là khóa riêng của thiết bị, không đưa cho khách; QR bên trong là vé HMAC ngắn hạn. Khóa lưu hash, API nhận header được redact trong log và trả `no-store`. QR tĩnh cũ không còn cấp quyền vào bàn.
- Chu kỳ theo phút của server, lần mở đầu có thể còn ít hơn 60 giây. Tablet ẩn mã hết hạn khi mất mạng. Đóng/chuyển phiên hoặc cấp lại khóa tăng `qrEpoch`; các API instance cần dùng chung secret và đồng hồ đồng bộ.
- API mới: `GET /table-displays/qr`, `POST /staff/tables/:id/display`, `POST /admin/tables/:id/display`, `GET /staff/awaiting-payments`, `POST /staff/orders/:id/payments`, `POST /staff/orders/:id/refund`. Prefix `/api/v1`.
- Xác nhận tiền dùng transaction và idempotency, kiểm số tiền/version; không phát `payment.confirmed` của luồng đóng phiên cũ. Phát `order.statusChanged` nên guest vẫn được gọi thêm. KDS và API chuyển công đoạn đều chặn đơn chưa trả tiền.
- Đóng phiên yêu cầu đơn đã phục vụ/hủy, không còn nợ/yêu cầu hủy chờ; chốt `Bill` snapshot trong cùng transaction, revoke guest/QR, giải quyết service request, rồi mở hộp hóa đơn cho Staff in. Receipt của khách tiếp tục chỉ đọc/đánh giá.
- Đơn đã trả tiền chưa pha chế chỉ được hủy sau xác nhận đã hoàn đủ tiền thủ công; ghi Payment REFUNDED, phương thức/ca/nhân viên/lý do hoàn và đối soát ca. UI hiện xác nhận hoàn tiền mặt; không tự chuyển tiền ngân hàng.
- Mỗi participant tối đa 3 đơn chờ thanh toán; hủy đơn chưa trả tiền giải phóng giới hạn. Rate limit hiện có vẫn áp dụng. Thanh toán gộp cuối phiên được giữ cho dữ liệu legacy đã phục vụ/chưa trả.
- Không ràng buộc IP/GPS/Wi-Fi. Khách đã vào phiên vẫn có thể gửi đơn chưa trả tiền/yêu cầu phục vụ từ xa đến lúc Staff đóng phiên; QR động và thu tiền trước không chứng minh hiện diện tại quán.
- 4G cần `PUBLIC_APP_URL` công khai và HTTPS/proxy/origin tương ứng. Chưa kiểm tra điện thoại 4G hoặc camera thật.
- Playwright đổi sang `E2E_DISPLAY_TOKEN`; benchmark seed dùng `BENCHMARK_DISPLAY_TOKEN`, k6 dùng `TABLE_DISPLAY_TOKEN` để lấy QR mới. Không dùng số hiệu năng cũ làm bằng chứng cho workload mới.
- Kiểm chứng source: lint/typecheck/build PASS; server unit 71/71, client 28/28, integration 53/53 (tổng 152). Chromium với Mongo replica set cô lập PASS luồng đặt/nhận tiền/KDS/gọi thêm/đóng/in/xem receipt, không có page error. Ảnh và log tại `.cache/prepay-browser/`, `.cache/prepay-*.log`.
- Hướng dẫn: `docs/qr-prepayment.md`; OpenAPI và README đã cập nhật. Không chạy lại seed hoặc xóa dữ liệu đang sử dụng.
- Đã build/recreate toàn bộ production-local bằng `docker compose -f compose.production.yaml up -d --build`, dùng `.env` gốc hiện có (không cần `.env.production`). Mongo/Redis, 4 API, web và 3 worker healthy; migrate exit 0. Smoke ba portal 8080/8081/8082, login Staff, API chờ tiền, KDS chỉ PAID, route isolation và giao diện cấu hình QR PASS, không page error. Không thay đổi đơn/khoản thu trong smoke production. Log `.cache/prepay-production-smoke.log`, ảnh `.cache/prepay-browser/production-staff.png`. Liên kết màn hình từng bàn cần cấp qua Staff/Admin trước khi khách dùng luồng mới.

## Ý định và phạm vi của người dùng

- Đây là bài tập lớn Lập trình Web cho một quán cà phê.
- Yêu cầu gần nhất: hoàn thiện luồng hiện có, sau đó tạo file Markdown để ghi nhớ dự án.
- Ưu tiên quy trình QR → vào bàn → chọn/AI gợi ý món → đặt món → pha chế → thanh toán → hóa đơn → đánh giá.
- Không tự mở rộng thành nhiều chi nhánh, giao hàng, quản lý kho nguyên liệu hay thanh toán online.
- Link tham khảo người dùng cung cấp: https://claude.ai/code/artifact/717f123b-c0bd-4b23-9671-59cf4faf0f99
- Chưa đọc được artifact: công cụ web không mở được URL, runtime Browser không có browser khả dụng. Không coi giao diện đã được đối chiếu với mẫu.

## Kiến trúc cần nhớ

- npm workspaces: client (React/Vite/TypeScript), server (Express/Mongoose/TypeScript), packages/contracts (Zod).
- MongoDB phải chạy replica set để dùng transaction; compose.yaml đã có cấu hình.
- Khách không đăng ký tài khoản. Mỗi thiết bị có participantId riêng trong tableSession.
- Staff thu tiền từng đơn trước pha chế, đóng phiên để chốt hóa đơn toàn bàn; khách chỉ xem đơn/hóa đơn của thiết bị mình.
- Socket.IO dùng room staff, session:<sessionId>, guest:<sessionId>:<participantId>.
- Backend là nơi quyết định giá, trạng thái và quyền truy cập.

## Những gì đã hoàn thiện trong lần này

### Vào bàn và QR

- GET /staff/tables cho STAFF/ADMIN, chỉ trả thông tin bàn cần dùng. Sửa lỗi trang staff gọi API chỉ cho admin.
- GET /table-sessions/current trả tên/mã bàn, trạng thái OPEN/CHECKOUT; sau đóng phiên trả receiptAvailable.
- Quét lại cùng bàn khi phiên còn hiệu lực giữ participantId để không mất quyền xem các đơn trước.
- JoinPage nhận token hoặc URL chứa /t/<token>, xóa cache dữ liệu phiên trước và gắn giỏ đúng phiên.
- AdminTables tạo ảnh QR bằng qrcode, có tải PNG. Token được đổi thủ công; ảnh chỉ hiển thị sau thao tác đổi token.
- Cookie mặc định host-only; .env.example để COOKIE_DOMAIN trống, dùng Vite proxy cho API/socket.
- Khách quét QR khi bàn trống thì server tự mở phiên (`ensureActiveSession`): phiên có `source:'GUEST'`, ghi audit `tableSession.autoOpened`, đẩy realtime cho Staff, idempotent và chống đua bằng cách bắt lỗi E11000 rồi đọc lại phiên vừa tạo, nên hai khách quét cùng lúc vẫn về chung một phiên.
- POST /table-sessions/join trả thêm `created` (true khi phiên vừa được mở); 403 chỉ còn khi `GUEST_AUTO_OPEN=false` và bàn chưa có phiên.
- Staff "Mở bàn" trên bàn đã có phiên trả về phiên hiện hữu với `created:false` thay vì 409 như trước.
- Trang staff hiện badge "Tự mở" cho phiên do khách mở.

### Phiên tự mở rỗng

- `server/src/services/idleSessionSweeper.ts` chạy mỗi 5 phút trong `server.ts`, đóng phiên `OPEN` + `source:'GUEST'` không có đơn nào ngoài CANCELLED quá `SESSION_IDLE_TIMEOUT_MIN` phút.
- Mặc định hết hạn sau 60 phút; `0` là tắt hẳn sweeper. Phiên bị đóng có `closedReason:'IDLE'`, thu hồi guest session và ghi audit `tableSession.idleClosed`.

### Đặt món, AI và pha chế

- Server từ chối size hết bán, thiếu size khi món có variants, topping không thuộc món và topping bị lặp.
- Lưu toppingNamesSnapshot trên order item; KDS hiển thị tên bàn và tên topping.
- ProductDetailModal chọn mặc định đường/đá hợp lệ, không cho chọn topping/variant đã hết.
- CartPage giữ Idempotency-Key khi thử lại sau lỗi mạng/5xx với cùng payload; khóa chỉnh giỏ trong lúc gửi.
- Khóa thao tác gửi đơn khi bàn CHECKOUT. Backend vẫn kiểm tra độc lập.
- Transaction đặt đơn ghi lên tableSession để tránh chạy đồng thời với đóng/chuyển phiên.
- KDS khóa nút khi đang chuyển trạng thái; có hủy đơn ở PENDING/CONFIRMED.
- AI có ô ngân sách và chọn không caffeine/không sữa; fallback hiểu một số mẫu tiếng Việt.
- AI lọc menu/variant khả dụng và điều kiện bắt buộc; không tự trả món trái ràng buộc khi không có kết quả.
- Chọn món AI mở bảng tùy chỉnh trước khi thêm giỏ.
- Trang menu có tìm kiếm tiếng Việt qua `POST /menu/search`: hỗ trợ không dấu/typo giới hạn, nhóm món, vị/ít ngọt, budget mỗi món (`dưới` khác `không quá`) và điều kiện caffeine/sữa. Backend lọc/xếp hạng menu thật; UI debounce 350 ms, hủy request cũ, hiện intent và cho sửa bộ lọc rồi mở lại `ProductDetailModal`.
- `không cà phê` chỉ loại nhóm cà phê, không đồng nghĩa `không caffeine`; metadata thiếu không được coi là đáp ứng `không caffeine`/`không sữa`. Search hiện luôn ghi `mode: fallback`; chưa chạy LLM live.

### Realtime và yêu cầu phục vụ

- Socket khách xác thực bằng cookie HttpOnly do browser gửi, không đọc document.cookie.
- Server phát sự kiện sau đặt/hủy/chuyển đơn, thay đổi phiên, thanh toán, yêu cầu phục vụ và cập nhật menu.
- Socket staff kiểm tra tài khoản còn hoạt động và vai trò.
- Hook useSocketEvent giữ đăng ký cả khi socket được tạo sau component hoặc tạo lại.
- Layout làm mới query sau sự kiện và khi kết nối lại; polling còn giữ làm phương án dự phòng.
- Khách có nút gọi nhân viên; trang yêu cầu hiển thị tên bàn.
- Đóng phiên/nghỉ bàn ngắt socket tương ứng. Thu tiền đóng luôn các yêu cầu phục vụ còn mở.

### Thanh toán, hóa đơn, đánh giá

- Staff chuyển bàn CHECKOUT → mở hộp kiểm tra món/tổng tiền → chọn CASH/BANK_TRANSFER/OTHER → xác nhận đã nhận đủ tiền.
- Chuyển khoản vẫn do nhân viên tự kiểm tra; chưa có cổng thanh toán/webhook.
- Sửa lỗi frontend luôn gửi amount=0.
- Server yêu cầu CHECKOUT, tất cả món đã SERVED/CANCELLED, số tiền khớp tổng chưa trả.
- Cùng payment key và cùng dữ liệu trả lại giao dịch cũ; đổi dữ liệu với key cũ trả 409.
- Query hóa đơn/thanh toán lấy toàn bộ đơn trong phiên, không cắt ở giới hạn phân trang 100.
- Đóng phiên trực tiếp chỉ được khi không còn đơn chưa thanh toán; hỗ trợ bàn không gọi món hoặc hủy hết đơn.
- Thu hồi quyền đặt món trong cùng transaction thanh toán.
- Cookie mc_receipt là token độc lập, lưu hash receiptTokenHash trong GuestSession; chỉ cấp quyền xem hóa đơn và đánh giá sau CLOSED.
- GET /receipts/current chỉ trả đơn SERVED/PAID của chính participant; POST /receipts/orders/:id/review kiểm tra ownership và đánh giá một lần.
- Trang /receipt hiển thị chi tiết, tổng tiền, form 1–5 sao/nhận xét và trạng thái đã đánh giá. Theo cập nhật 27/09/2026, thao tác in sau thanh toán thuộc phía nhân viên.
- Admin có trang /admin/reviews: danh sách đánh giá, điểm trung bình, phân bố 1–5 sao, lọc theo số sao/ngày và phân trang 20 mục. API GET /admin/reviews chỉ cho ADMIN.
- Receipt hết hạn theo GuestSession (12 giờ kể từ join), bị xóa quyền khi rời bàn. Không dùng để gọi thêm món hay mở socket.
- GuestSession cũ từ trước thay đổi chưa có receiptTokenHash: rời bàn và vào một phiên mới để demo trọn luồng.
- Phiên khi thu tiền được chốt thành snapshot `Bill` bất biến: unique theo `tableSessionId`, không có API sửa/xóa, ghi trong cùng transaction với payment và việc đóng phiên (`closedReason:'PAID'`); response payments trả thêm `billId`.
- GET /staff/table-sessions/:id/bill đọc snapshot cho phiên đã đóng, fallback tính động cho phiên cũ chưa có Bill.
- GET /receipts/current đã bỏ field nội bộ (`idempotencyKey`, `requestHash`, `statusHistory`, `version`, `__v`) và dùng `Bill` snapshot bất biến; chỉ phiên legacy chưa có Bill mới fallback về `Order`.
- Phiên `CLOSED` không chặn phiên mới: partial unique index `one_active_session_per_table` chỉ áp cho OPEN/CHECKOUT.

## Các file trọng tâm

- server/src/routes/index.ts
- server/src/controllers/{tableSessionController,orderController,paymentController,receiptController}.ts
- server/src/services/{orderService,paymentService,tableSessionService,aiService}.ts
- server/src/models/Bill.ts, server/src/repositories/billRepository.ts, server/src/services/idleSessionSweeper.ts
- server/src/middlewares/guest.ts
- server/src/realtime/socket.ts
- client/src/lib/socket.ts
- client/src/layouts/{GuestLayout,StaffLayout}.tsx
- client/src/features/staff/{Tables,KDS,ServiceRequests}.tsx
- client/src/features/guest/{JoinPage,CartPage,ProductDetailModal,ReceiptPage}.tsx
- client/src/features/ai/AISheet.tsx
- client/src/features/admin/Tables.tsx

## Kiểm chứng gần nhất — 22/09/2026

- Typecheck server + client + contracts: PASS.
- Lint server + client: PASS, không còn lỗi/cảnh báo và không tắt rule để che lỗi.
- Unit server: 58/58 PASS; client: 14/14 PASS; integration server: 28/28 PASS.
- Production build: PASS; Vite còn cảnh báo bundle JS chính 989,87 kB (gzip 291,75 kB).
- Refresh access token staff đã có single-flight, retry một lần, kiểm soát race logout; có 6 test client chuyên biệt.
- Auth/payment contract dùng chung đã được cả client và server tiêu thụ; requestId client được kiểm tra định dạng/độ dài.
- P2 production-local đã được build và chạy bằng Docker Engine 29.7.2: project riêng `maycafe-production` có MongoDB/Node/Nginx healthy; Nginx publish Guest `8080`, Staff `8081`, Admin `8082`. Frontend, deep-link, API, readiness và WebSocket cùng-origin đã được kiểm tra.
- P3 observability đã hoàn thành production-local: Node.js 24 LTS, structured log không trùng Morgan, Prometheus metrics nội bộ, Admin `/admin/operations`, nhãn route cardinality-safe và payment replay không tăng counter. Lỗi kiểm soát `p3-controlled-error` đã đối chiếu log/dashboard.
- P4A search đã hoàn thành local: 25/25 unit (13/13 Top-1, 12/12 ràng buộc) và integration API qua MongoDB tạm đạt; kết quả fallback/live được ghi riêng trong `docs/ai-evaluation.md`.
- P4B đã hoàn thành local: scheduler detector cho HTTP error/p95, preparation p95 và cancellation rate; baseline/min-sample/threshold cấu hình, alert MongoDB dedupe+cooldown, AI/fallback explanation, ADMIN ACK/CLOSE có audit. HTTP window còn là instance-local nên chưa dùng cho multi-instance trước P5.
- Luồng container đã PASS trên volume riêng: seed → QR join → order → pha chế → checkout → payment → Bill → receipt; graceful SIGTERM exit 0 khoảng 0,5 giây và restart healthy. Chưa deploy cloud/HTTPS và chưa gọi đây là high availability.
- E2E curl 14/14 bên dưới là lịch sử ngày 17/09. Playwright production build đã được chạy mới ngày 22/09 và đạt 9/9 ở ba viewport; xem phần P5/P6 cuối file.
- Integration server mới nhất: 42/42 PASS trên MongoMemoryReplSet thật.
- `server/vitest.config.ts` phải tách mỗi file test sang process riêng (`isolate: true`, `singleFork: false`, `maxForks: 1`): nhiều file test dùng chung một mongoose instance gây `OverwriteModelError`.
- E2E curl trên server thật + MongoDB thật: 14/14 PASS — join bàn trống 200 `created:true` → đặt đơn 201 → thu tiền 201 kèm `billId` → gọi lại 200 cùng `billId` → quét lại QR ra phiên mới rồi đặt đơn 201; cookie cũ 401; receipt không lộ field nội bộ.
- Browser QA: PASS — khách vào thẳng `/menu` thấy tên bàn và đặt được đơn qua UI; trang staff hiện badge "Tự mở".
- Test bao phủ thêm: tự mở phiên + audit khi quét QR bàn trống, replay thanh toán kèm `billId`, đóng phiên rồi mở phiên mới, sweeper idle đóng phiên + thu hồi guest session.
- Test unit/server, UI client, integration, lint, typecheck và build đã được chạy lại ngày 22/09/2026 như số liệu phía trên.
- AI live đã được gọi thử có giới hạn nhưng provider từ chối key với HTTP 401; chỉ fallback/ràng buộc nội bộ được xác nhận đạt, chưa có kết quả LLM live hợp lệ.
- Integration dùng database tạm riêng; riêng E2E thủ công có tạo dữ liệu thật trong DB demo (xem mục "Việc còn lại và ranh giới").
- `npm audit` hiện 0 vulnerability sau khi nâng Vite 8, Vitest 5, React Router 7 và UUID 14; không dùng `npm audit fix --force`.

## Chạy và demo

1. npm ci
2. Tạo server/.env từ .env.example, cấu hình MongoDB replica set.
3. npm run db:up → npm run db:wait → npm run seed (seed chỉ dành cho dữ liệu demo; có thể thay dữ liệu hiện tại).
4. `npm run dev` dùng portal hợp nhất tại `5173`; production-local tách Guest `8080`, Staff `8081`, Admin `8082` qua cùng Nginx.
5. Admin vào Bàn & QR, đổi token và tải ảnh QR.
6. Khách quét QR/vào link để tự mở phiên → chọn món hoặc hỏi AI → giỏ → gửi đơn.
7. Staff vào Bàn & phiên và thấy phiên mới xuất hiện realtime, không cần mở bàn trước.
8. KDS: nhận → đang pha → sẵn sàng → đã phục vụ.
9. Khách yêu cầu thanh toán; staff chuyển CHECKOUT → kiểm tra & thu tiền → xác nhận số tiền đã nhận.
10. Nhân viên mở hóa đơn toàn bàn đã chốt sau thu tiền → in hóa đơn. Khách tự chuyển /receipt → xem hóa đơn trên thiết bị → đánh giá.
11. Có thể thử hai browser profile/thiết bị cùng bàn để kiểm tra phân tách đơn.

Demo LAN: PUBLIC_APP_URL phải là địa chỉ frontend mà điện thoại truy cập (ví dụ http://192.168.1.10:5173); COOKIE_DOMAIN để trống; VITE_API_BASE_URL=/api/v1 và VITE_SOCKET_URL=/ dùng proxy. Khởi động lại server/client khi đổi env. Không đưa secret vào file này.

Biến môi trường mới trong `.env.example`: `GUEST_AUTO_OPEN=true` (cho khách tự mở phiên khi quét QR bàn trống) và `SESSION_IDLE_TIMEOUT_MIN=60` (số phút trước khi sweeper đóng phiên khách bỏ trống; `0` là tắt sweeper). Muốn rollback hành vi tự mở phiên chỉ cần đặt `GUEST_AUTO_OPEN=false` — không phải revert code.

## Việc còn lại và ranh giới

- Playwright tự động ở 375/768/1440 đã đạt; PWA reload offline đã có smoke test. Còn quét ảnh QR/camera thật, kiểm tra trực quan thủ công và chạy ca browser hai thiết bị trên backend production-local khi Docker hoạt động.
- Lint hiện đạt 0 lỗi/cảnh báo. Route-level lazy loading giữ entry client ở 389,20 kB (gzip 118,78 kB); chunk lớn nhất là Dashboard 384,70 kB (gzip 102,48 kB), đều dưới ngưỡng 500 kB.
- Dashboard đã có lọc ngày, CSV và in/lưu PDF; aggregation không còn cắt ở 100 đơn. Lịch sử đơn admin, voucher và upload ảnh là mở rộng sản phẩm ngoài luồng cốt lõi hiện tại.
- Đã triển khai tự refresh access token staff ở frontend; access token vẫn chỉ giữ trong memory, refresh token ở cookie HttpOnly.
- Không xem docs cũ hay số lượng tính năng trong README là bằng chứng đã test: ưu tiên file này và docs/test-report.md.
- Index tableSession mới one_active_session_per_table bảo đảm chỉ một OPEN/CHECKOUT mỗi bàn. Với DB cũ có dữ liệu trùng phiên hoạt động, cần xử lý dữ liệu trước khi tạo index; không tự xóa dữ liệu.
- Phiên bản API OpenAPI đã bổ sung staff tables và receipt endpoints. Contracts chung hiện bao phủ thêm join/current table session và request chuyển trạng thái; vẫn chưa chuẩn hóa mọi response quản trị cũ.
- E2E thủ công 17/09/2026 đã tạo dữ liệu thật trong DB demo: bàn `B03` đã thu tiền, bàn `B04` còn 1 đơn PENDING `MCX29XD` kèm phiên mới do auto-open. Người dùng tự dọn nếu cần; không tự xóa dữ liệu.
- Các câu hỏi §11 của issue đã chốt: Q1 mặc định `GUEST_AUTO_OPEN=true` kèm công tắc; Q2 bật idle timeout 60 phút; Q3 vẫn cho nhiều guest session song song theo thiết bị (giữ nguyên); Q4 `Bill` là nguồn cho cả staff bill và `/receipts/current`, có fallback legacy; Q5 không thêm van "xác nhận đơn đầu tiên".
- Các finding khác trong `audit_2026-09-16.md` §12 nằm ngoài phạm vi issue này, mới chỉ ghi nhận chứ chưa sửa.

## Nguồn đã tra cứu khi triển khai

- qrcode API và Promise toDataURL: https://github.com/soldair/node-qrcode
- Socket.IO client options/cookies: https://socket.io/docs/v4/client-options/

## Cập nhật P5/P6 mới nhất — 22/09/2026

Phần này thay thế các ghi chú cũ nói P5/chạy responsive/load/AI live chưa thực hiện.

- Baseline P5 ngày 22/09 dùng Nginx + `server-a` + `server-b` + `worker-1`; số tải/failover bên dưới thuộc topology cũ này. Source production hiện dùng hai pool `server-guest-a/b`, `server-internal-a/b` và ba role `worker-scheduler/realtime/report`; stack runtime cũ cần recreate để nhận topology mới.
- Failover local: 20/20 request qua B khi A dừng, tối đa khoảng 1.036 ms. Redis outage để read menu hoạt động, readiness `degraded`, mutation không tự bỏ limiter. Đây không phải HA cả máy/cloud.
- Load test k6 dùng DB `maycafe_benchmark`, 200 sản phẩm. Menu fixed hai backend đạt cao nhất 90 RPS (p95 96,48 ms); 100 RPS p95 3,26 s; ramp 600–700 không đạt. Guest 20 VU/60 s có 0 lỗi nhưng write p95 4,15 s nên không đạt ngưỡng. Realtime 100/100, connect p95 324,05 ms.
- Load test phát hiện `dropDatabase()` của benchmark seed xóa unique index và cho tạo nhiều phiên active. Seed nay import mọi model + `syncIndexes()` trước dữ liệu; `check:benchmark` xác nhận đúng một active session, không trùng idempotency key, sai tổng hay trạng thái. Không dùng kết quả trước sửa làm bằng chứng.
- Playwright production build đạt 9/9 ở 375×812, 768×1024 và 1440×900 cho join/login/menu sau link QR mô phỏng; không tràn ngang/page error. Camera/in QR thật vẫn để test sau theo yêu cầu người dùng.
- GitHub CI nằm ở `.github/workflows/ci.yml`, dùng Node 24/npm ci và chạy audit, lint, typecheck, server/client tests, integration, build và browser smoke. Run #1 trên commit `b61a8f0` đã PASS cả ba job.
- AI live smoke đã thử 3 recommendation + 1 anomaly explanation với key trong `apikey.txt`, provider trả 401 cả bốn. Fallback an toàn hoạt động; key bị từ chối phải thay trước khi gọi AI live là đạt. `apikey.txt` bị Git ignore; logger không ghi provider error body.
- Báo cáo nguồn chuẩn: `docs/performance-report.md`, `docs/test-report.md`, `docs/deployment.md`, `docs/upgrade-progress.md`, `docs/ai-evaluation.md`.
- Cloud chưa deploy. Cần người dùng chốt provider/account có quyền, region, ngân sách, domain/DNS, Mongo/Redis managed hay tự quản, secrets production và quyền repo cho CD. Không tự tạo tài nguyên có phí.

## Điểm tiếp tục ở phiên làm việc sau

### Cập nhật cải tiến còn lại — 23/09/2026

- Client dùng lazy route; entry production giảm từ khoảng 990 kB xuống 389,20 kB (gzip 118,78 kB), không còn cảnh báo chunk >500 kB.
- PWA production có manifest/service worker, precache theo Vite asset manifest, reload offline đạt; API và Socket.IO không bao giờ được cache. UI báo mất mạng/kết nối lại và giỏ vẫn persist để người dùng tự thử gửi lại.
- Dashboard hỗ trợ khoảng ngày, CSV và in/PDF. Backend dùng MongoDB `$facet` trên toàn bộ đơn PAID, nhóm theo `Asia/Ho_Chi_Minh`; integration 105 đơn khóa hồi quy giới hạn phân trang cũ.
- Contracts chung bổ sung join/current table session và request transition. Script root build contracts trước dev/typecheck/test để checkout sạch và CI không phụ thuộc `dist` cũ.
- Vite 8.3.0, Vitest 5.0.1, React Router 7.18.4 và UUID 14.0.2; `npm audit` 0 vulnerability. Vitest config đã đổi khỏi `poolOptions` bị loại bỏ.
- CI có thêm audit và browser smoke production frontend. Playwright có 11 ca; production-local ba portal đạt 7 ca độc lập dữ liệu, skip 4 ca cần `E2E_TABLE_TOKEN`; offline reload đạt.
- Kiểm tra local mới nhất: lint PASS, typecheck PASS, server 67 unit/client 17/integration 42 PASS, build PASS, Compose config PASS, Playwright trên build mới 7 PASS/4 SKIP. Chưa chạy lại benchmark k6 đầy đủ.
- Production-local tách Guest `8080`, Staff `8081`, Admin `8082` trên cùng Nginx. Proxy chặn route/API gọi chéo; CORS/Socket cho phép đúng ba origin và refresh-cookie Staff/Admin tách tên để đăng nhập đồng thời.
- Traffic `8080` chỉ vào pool Guest; `8081/8082` chỉ vào pool Internal. Bốn API container có CPU/RAM limit; Internal dùng `cpu_shares=1536`, Guest `512`. Health API trả `trafficClass` để smoke routing. Nginx dùng Docker DNS `resolve` động để không giữ IP container cũ sau recreate; app-level guard chặn gọi chéo ngay cả khi bypass proxy.
- Guest được giới hạn hai lớp: Nginx burst/connection trả 429 và shared Redis limiter theo token/phiên bàn (join 20/phút, order 12/phút, service request 6/phút mặc định). Menu public cache Redis 60 giây và invalidation bằng generation khi Admin sửa catalog.
- Worker xử lý queue ưu tiên thông báo realtime trước report, hỗ trợ retry/dead-letter; Admin dashboard và CSV dùng report job async. Smoke local đã xác nhận JSON/CSV `COMPLETED`, realtime queue drain sạch và burst 100 request trả 200/429, không còn 503.

- Xem mục “Cập nhật P5/P6 mới nhất” và `docs/upgrade-progress.md` trước; không chạy lại benchmark nặng nếu không có thay đổi liên quan hiệu năng.
- Production-local hiện đang chạy healthy trên ba portal `8080`/`8081`/`8082`; Mongo/Redis, bốn API pool, web healthy và worker đang chạy. Health, login, cookie isolation, pool routing, worker jobs, rate limit và ma trận route/API đã smoke PASS ngày 23/09/2026.
- Container web của project `maycafe-benchmark` đã dừng để nhường cổng `8081`; Mongo/Redis và volume benchmark không bị xóa, có thể khởi động lại với cổng khác.
- Việc cần người dùng cung cấp tiếp: key AI hợp lệ nếu muốn test live; hoặc lựa chọn cloud/account/region/budget/domain nếu muốn deploy thật. Không yêu cầu lại camera/in QR cho tới khi người dùng muốn thực hiện bước đó.
- Toàn bộ P1–P7 đã commit/push lên `main`; GitHub Actions run #1 (`35807566033`) PASS cả quality/build, integration và production frontend browser smoke.
- Không ghi hoặc in nội dung `apikey.txt`. File này và `.cache/load` đang được Git ignore.

## Cập nhật cải tiến A1 — 23/09/2026

- Đã thêm `OutboxEvent` trong MongoDB và relay chạy ở worker. Relay claim bằng lease, retry exponential có giới hạn, giữ cùng `eventId` khi enqueue Redis và chỉ đánh dấu `PUBLISHED` sau khi queue nhận thành công.
- Order create/cancel/transition, payment, table-session open/reopen/transition/idle-close và service-request create/resolve nay ghi business state, audit và realtime outbox trong cùng transaction. Controller không còn tự phát notification sau commit cho các luồng này.
- Payment/đóng phiên phát event tới room khách rồi consumer mới ngắt socket; khách vẫn nhận `payment.confirmed` trước khi mất kết nối. At-least-once được chấp nhận, nên event có thể trùng khi worker dừng đúng khoảng enqueue/mark.
- `npm run dev` nay chạy thêm worker. API `TRAFFIC_CLASS=unified` có relay cùng process để dev/test vẫn hoạt động; khi Redis không sẵn sàng nhưng Socket.IO local tồn tại, relay phát trực tiếp từ bản ghi outbox.
- Config mới: `OUTBOX_POLL_MS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_LEASE_MS`, `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_RETRY_BASE_MS`, `OUTBOX_RETRY_MAX_MS`.
- Kiểm tra local sau thay đổi: lint PASS, typecheck PASS, server unit 61/61, client 15/15, integration 30/30, production build PASS. Integration có ca ép rollback chứng minh TableSession/AuditLog/OutboxEvent cùng rollback và ca replay chứng minh không sinh thêm event.
- Ghi chú lịch sử này đã được thay thế bởi đợt hoàn tất A1–D1 bên dưới.

## Hoàn tất kế hoạch A1–A3, B1–B4, C1–C7, D1 — 23/09/2026

- Outbox/audit đã bao phủ mutation catalog và availability; Admin operations xem/replay outbox `FAILED` và Redis dead-letter có audit.
- Production tách `worker-scheduler`, `worker-realtime`, `worker-report`; queue dùng atomic claim + owner lease/renew/ACK, reclaim, backoff, dead-letter/replay; scheduler có leader lease, worker heartbeat/progress và telemetry tuổi queue/Redis memory. Redis drill đạt isolation report/realtime, foreign ACK, reclaim và replay.
- Realtime event có envelope ID/schema/entity/version/time; client dedupe bounded, bỏ version cũ và refetch khi reconnect.
- Order dùng quote ký HMAC và một pricing service chung; receipt dùng Bill snapshot bất biến với fallback legacy.
- Module boundary lint chặn controller import model/UoW. Production tắt auto-index; migration runner build có lock/checksum/preflight và được Compose gate trước API/worker.
- Đã thêm KDS SLA, staff availability, Admin bill history/reprint, cancel approval, chuyển bàn, cash shift reconciliation, AI evidence + final configuration validation cùng API/UI/test.
- MongoDB 7 drill: cả 3 migration apply rồi skip idempotent; backup/restore 4 business document và migration state, 0 Bill trùng phiên, 0 Payment mồ côi, đủ index bắt buộc. Biên bản ở `docs/restore-drill-2026-09-23.md`.
- Quality gate cuối: lint/typecheck/build/audit/Compose PASS; server 67/67, client 17/17, integration 42/42. E2E trên production frontend mới đạt 7 PASS/4 SKIP; bốn ca cần token bàn không được tính PASS.

## Sửa lỗi S1–S4 theo `claude_de_xuat.md` — 24/09/2026

- Kế hoạch mới nằm ở `claude_de_xuat.md`; người dùng đã loại N1 (tách hóa đơn theo khách) và N2 (VietQR).
- S1: `GET /staff/orders` chỉ trả đơn PENDING..READY của phiên OPEN/CHECKOUT (`orderService.listOrdersForStaff`); trước đó trả mọi đơn SERVED từ trước tới nay.
- S2: đặt món và thanh toán gặp request cùng Idempotency-Key vượt qua bước kiểm tra trước sẽ trả replay (đơn: bắt 11000 trên `idempotencyKey`; payment: kiểm lại key khi transaction lỗi). Trùng mã đơn thì sinh mã mới. Giỏ hàng chỉ đổi key khi server trả `IDEMPOTENCY_CONFLICT`.
- S3: DTO `guestOrderSchema`/`staffOrderSchema` trong contracts, serializer `server/src/services/orderDto.ts`; API đơn không còn trả `idempotencyKey`, `requestHash`, `__v`; khách không thấy ID nhân viên trong `statusHistory`.
- S4: Nginx bật gzip, header bảo mật và CSP enforce qua `docker/nginx/maycafe-security-headers.inc` (chỉ cho location SPA); `index.html`/`sw.js` no-cache. `img-src` cho mọi `https:` vì ảnh món là URL admin nhập.
- Kiểm chứng: lint/typecheck/build PASS; server 67/67, client 19/19, integration 46/46; E2E 7 PASS/4 SKIP; duyệt ba portal 0 vi phạm CSP.
- Production-local đã dựng lại từ source hiện tại ngày 24/09/2026 theo topology mới (API guest/internal A/B, `worker-scheduler/realtime/report`, migrate); container `worker` cũ đã gỡ. Migration 001–003 áp dụng rồi skip khi chạy lại; số document nghiệp vụ không đổi (101 đơn, 43 payment, 2 bill). Backup trước nâng cấp: `.cache/backup/maycafe-20260924-002643.archive.gz` (SHA-256 `35958d84…31fc6`).
- JWT secret của production-local nằm trong `.env` ở thư mục gốc (bị Git ignore, tạo ngày 24/09/2026 từ giá trị stack đang chạy). `docker compose -f compose.production.yaml up -d` tự đọc file này; không xóa hay đổi giá trị nếu không muốn mọi phiên staff/admin hết hiệu lực. Không in nội dung file.
- Lỗi phát hiện khi chạy stack mới: trang Admin → Hóa đơn gửi bộ lọc rỗng và bị 422. Đã sửa `billHistoryQuerySchema` coi chuỗi rỗng là không lọc; unit test `billHistoryQuery.test.ts`. Server unit nay 69/69.

## Chuyển thao tác in hóa đơn sang nhân viên — 27/09/2026

- Theo yêu cầu người dùng, bỏ nút in trên trang hóa đơn khách; khách vẫn xem đơn của thiết bị mình và đánh giá.
- Staff → Bàn & phiên: thanh toán thành công tự mở hộp hóa đơn toàn bàn, nhân viên bấm “In hóa đơn”. Dữ liệu lấy lại từ API bill của phiên CLOSED (snapshot đã chốt), không dùng bản xem trước khi thu tiền.
- Hộp hóa đơn nằm ở cấp trang, không biến mất khi phiên đã đóng bị loại khỏi danh sách bàn đang phục vụ. Có nút mở lại hóa đơn vừa thanh toán trong lần mở trang hiện tại; Admin vẫn có lịch sử/in lại hóa đơn.
- Lỗi tải hóa đơn có nút thử lại độc lập, không gửi lại thanh toán. CSS in chỉ hiển thị hóa đơn, bỏ giao diện vận hành và nút thao tác.
- Kiểm chứng source: client 21/21 test PASS (bao gồm realtime xóa thẻ bàn trước phản hồi thanh toán, tải lại hóa đơn sau lỗi, in toàn bàn và khách không có nút in); lint client và production client build PASS. Chưa rebuild container production-local hoặc kiểm tra máy in thật trong lần này.
- Sau đó đã rebuild và recreate riêng service `web` theo yêu cầu chạy lại để test (27/09/2026). Container healthy, ba portal 8080/8081/8082 và `/healthz` trả HTTP 200; bundle Staff đang phục vụ đã xác nhận có chức năng in mới. Giữ nguyên backend và dữ liệu; chưa kiểm tra máy in thật.

## Gọi món bằng một nút — 27/09/2026

- Giỏ khách chỉ cần bấm “Đặt món”: frontend tự lấy quote kiểm tra giá/tình trạng món rồi gửi đơn ngay khi giá không đổi. Chỉ yêu cầu đồng ý thêm nếu tổng giá mới khác giá trong giỏ; hết món/lỗi kiểm tra thì giữ giỏ và không gửi đơn.
- Khóa sửa giỏ và nút đặt trong cả thời gian lấy quote lẫn gửi đơn. Retry lỗi mạng giữ quote và Idempotency-Key để lấy lại đơn đã tạo, tránh đơn trùng; QUOTE_CHANGED xóa quote để lần thử tiếp theo kiểm tra lại.
- Client 24/24 test, lint và build PASS. Đã rebuild/recreate riêng web, xác nhận bundle Cart mới đang được phục vụ; container healthy, ba health endpoint 8080/8081/8082 trả 200.
