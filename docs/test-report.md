# Test report — cập nhật 21/10/2026

## Trang đặt món mang đi và giỏ nổi — 21/10/2026

- Storefront khách riêng xanh/kem/đào, ảnh lớn, danh mục/tìm/phân lô; giỏ nổi cố định với số lượng/tổng, bảng giỏ chỉnh số lượng/xóa/thông tin nhận/hẹn giờ/ưu đãi. Staff/Admin giữ form cũ. **100 client tests PASS**, sau thêm ca danh mục/search/phân lô, **5 route tests PASS** cuối (101 ca hiện có); lint/TypeScript/build/Docker web build PASS. Logs `.cache/pickup-storefront-{tests,routes,lint,build,docker-build-final}.log`.
- Lightpanda DB tạm PASS đăng nhập/catalog/AI/giỏ nổi/tăng giảm/giữ nháp qua tab/đặt ngay+hẹn giờ/Staff thấy đơn, bảo toàn QR gate/giỏ bàn/không phiên bàn giả, 0 exception/5xx; `.cache/pickup-storefront-lightpanda.log`. **Chỉ DOM/hành vi; bố cục/màu/kích thước thực tế, che khuất và điện thoại thật chưa chứng minh trực quan.**
- Recreate riêng web/PWA23, healthy. Local Lightpanda read-only PASS health/portal isolation/deep links/member gate/nav/QR gate, không table reads trong pickup, không giao dịch thử hoặc thay dữ liệu quán; `.cache/pickup-storefront-local-smoke.log`. Browser/relay tạm dọn, ba portal giữ chạy. `docs/pickup.md` có 19 ca tự test.

## Trang mang đi độc lập luồng QR — 21/10/2026

- PickupLayout riêng `/pickup`, `/pickup/orders`, `/pickup/member`; không guest-session/socket/cart bàn. Login trong trang này quay về form đặt món; nháp thường qua tab giữ trong context theo owner, pending bất định vẫn theo sessionStorage/idempotency. Menu/AI tại bàn yêu cầu QR, không tự chuyển pickup. **99 client tests PASS**, lint/typecheck/build/Docker web build PASS. `.cache/pickup-separate-{tests,lint,typecheck,build-final,docker-build}.log`.
- Lightpanda DB tạm kiểm trực tiếp entry/login/catalog/AI/nháp/create/orders không table API/phiên giả; QR gate và hai giỏ tách nhau; đặt hẹn giờ VN khi đang có cookie bàn; Staff thấy đơn. 0 JS exception/5xx; `.cache/pickup-separate-lightpanda.log`. DOM/hành vi; không bằng chứng render/layout/thiết bị thật.
- Chỉ recreate web/PWA22, healthy. Local read-only PASS health/portal isolation+deep links/nav/member gate/no table API/chuyển QR/menu gate, 0 exception/5xx; `.cache/pickup-separate-local-smoke.log`. Không đổi backend/dữ liệu, không tạo giao dịch thử trên quán; browser/relay tạm dọn, ba portal giữ chạy.

## Chọn món từ thực đơn khi chưa có bàn — 21/10/2026

- ProductDetailModal dùng chung kiểm đích giỏ: anonymous chưa bàn → login/no success; member chưa bàn → nháp pickup/toast riêng; đã ở bàn → cart tại bàn; lỗi kiểm member không success. AISheet dùng chung guard, callback giỏ pickup giữ nguyên. **96 client tests PASS**, lint/TypeScript+build/Docker web build PASS, `.cache/menu-cart-guard-{tests,lint,build,docker-build}.log`.
- Lightpanda DB tạm kiểm đường thực đơn thực, anonymous không giỏ mồ côi/thông báo thành công, member chuyển món đúng nháp pickup, 0 exception/5xx; `.cache/menu-cart-guard-lightpanda.log`. Recreate riêng web/PWA21 healthy. Local read-only kiểm lại menu chưa bàn → login/no success/no cart, health/PWA ba portal, 0 exception/5xx; `.cache/menu-cart-guard-local-smoke.log`. Không giao dịch thử trên quán; browser/relay tạm dọn. Chỉ DOM/hành vi, không xác nhận render trực quan.

## Giao diện khách ít chữ — 21/10/2026

- Rút gọn hướng dẫn/nhãn Pickup và AI, thẻ món khách chỉ tên/giá/dấu +; chính sách Member/đổi điểm Cart trong details đóng mặc định, giữ cảnh báo giá/giờ/lỗi và chức năng hiện có. **93 client tests PASS**, lint/TypeScript/build/Docker web build PASS. Logs `.cache/guest-copy-{tests,lint,build,docker-build}.log`.
- Lightpanda DB tạm PASS copy guest/help đóng-mở/search/xem thêm/cấu hình/giỏ/hẹn giờ/đóng nháp và luồng Staff, 0 exception/5xx; `.cache/guest-copy-lightpanda.log`. Chỉ DOM/hành vi; bố cục trực quan và thiết bị thật chưa xác minh.
- Recreate riêng web/PWA20 healthy; local read-only smoke cuối PASS 3 portal/health/isolation/nav/catalog/draft/history/workforce/logout, `.cache/guest-copy-local-smoke-final.log`. Không thay backend hoặc dữ liệu nghiệp vụ; không tạo giao dịch thử trên quán. Browser/relay tạm đã dọn.

## Sidebar và form mang đi dễ chọn món — 21/10/2026

- Sửa sidebar cho nhãn desktop xuống dòng và badge không co; tăng ảnh/chữ thẻ món, chia phần form, bỏ khung cuộn nhỏ, phân lô 6 món/Xem thêm, search/trạng thái rỗng, nút tới giỏ. Dùng chung Guest/Staff/Admin, không đổi nghiệp vụ.
- Client suite **92 PASS**; sau thêm test phân lô/tìm và chọn món thứ 7, riêng pickup **10 PASS**. Client lint/TypeScript+build và Docker web build PASS. Lightpanda DB tạm kiểm Guest/Staff phân lô 6→7/search/tùy chỉnh/giỏ/hẹn giờ/tới giỏ/đóng nháp, markup nhãn sidebar và badge, không JS exception/5xx. Logs `.cache/pickup-ui-{tests,paging-test,lint,build,docker-build,lightpanda}.log`.
- Chỉ recreate web, PWA19. Local read-only smoke PASS health/3 portal/isolation/nav/catalog/draft/history/workforce/logout, không JS exception/5xx; `.cache/pickup-ui-local-smoke.log`. **Lightpanda không cung cấp bằng chứng render trực quan: chưa xác nhận hết clipping, bố cục/kích thước thực tế hay thiết bị cảm ứng.** Không thay dữ liệu quán/backend hoặc chạy migration. Browser/relay tạm đã dọn, web giữ chạy.

## AI mang đi và thông báo đơn mới — 21/10/2026

- **382 tests PASS: 105 unit server + 185 integration + 92 client**. Thêm auth AI bằng thành viên không cần phiên bàn, CSRF/revoke và không cấp quyền đặt tại bàn; AI chọn đúng giỏ, nhúng vào đơn nháp, không tái thêm món sau đóng nháp; thông báo đơn chưa thu, cùng số lượng nhưng đổi ID, replay/poll không trùng, badge lấy total >30, gọi toast/âm báo và fan-out sự kiện tới layout lẫn trang. Lint/typecheck/build PASS. Logs `.cache/pickup-feedback-{unit,integration,client-complete,lint-final,typecheck-verified,build}.log`.
- Lightpanda hai browser độc lập + Mongo replica set tạm PASS AI fallback ngoài bàn → kiểm cấu hình → giỏ mang đi → tạo đơn chưa thu → Staff toast/badge/list cập nhật trong 629ms; AI nhúng vào giỏ; đặt tại bàn chưa thu có toast/badge, thành viên vẫn đăng nhập sau QR, AI tại bàn đúng giỏ, không JS exception/5xx. `.cache/pickup-feedback-lightpanda.mts`, `.cache/pickup-feedback-lightpanda.log`. Đường gọi WebAudio kiểm bằng stub trong browser và test UI; **chưa chứng minh âm ra loa thật, thông báo hệ điều hành, CSS/layout hoặc điện thoại thật**. Không gọi provider AI live; giao dịch thử chỉ trên DB tạm.
- Đã build Docker server/web và recreate local, toàn stack healthy, migration skip/exit0. Backup `.cache/maycafe-before-pickup-feedback-20261021.archive.gz`; hash/count 21 collection nghiệp vụ trước/sau bằng nhau. Lightpanda local read-only PASS health/PWA18/route isolation/member gate/Staff-Admin login-nav-catalog-draft-history/workforce/logout, không JS exception/5xx; `.cache/pickup-feedback-local-smoke.log`. Browser/relay tạm đã dọn, giữ ba portal chạy; không seed/reset hoặc tạo giao dịch thử trên quán.


## Mang đi và đặt trước nhận tại quầy (#6) — 20/10/2026

- **373 tests PASS: 105 unit server + 184 integration + 84 client**, thêm 18 integration và 9 client. Sau thay đổi cuối về bộ lọc vận hành/metadata hóa đơn, 18 pickup integration + 10 anomaly unit kiểm lại đạt 28/28; client cuối toàn 84/84. Typecheck/lint/whitespace PASS, Docker production build cuối compile server/client PASS. Một lượt lặp client song song và root build host gặp thiếu bộ nhớ khi chạy cùng Docker build; client chạy lại tuần tự `--maxWorkers=1 --no-file-parallelism` đạt, Docker build đã kiểm source cuối. Logs `.cache/pickup-{unit,integration,client-final,final-regression,final-client,typecheck,lint,docker-build-final}.log`.
- Integration: auth/role/ownership/strict payload/contact privacy, quote gắn contact/giờ/owner/options/giá/tồn, idempotency concurrent và namespace, giới hạn 3 active có race, tranh nguyên liệu cuối, trả giữ khi hủy, partial/zero payment và race/replay, giờ hẹn/không pha sớm/KDS, nhận thực tế mới tích điểm/chốt Bill, mixed voucher+điểm/hoàn, no-show trước/sau pha, rollback Order/Payment/kho/ưu đãi/activity/Bill/audit/outbox, correction được duyệt và giữ snapshot, migration unique cũ→partial apply/rerun không đổi dữ liệu.
- Client: anonymous gate, giỏ riêng/quote/create, xác nhận khi tổng đổi, giờ VN, network/5xx giữ payload/requestId qua reload, payment giữ key/version từ lúc mở form dù refetch, hoàn cần lý do/xác nhận, đổi identity không thấy cache cũ, invoice hiển thị voucher/điểm/options và khách không có nút in.
- Lightpanda build cuối + Mongo replica set tạm PASS login → tùy chỉnh → quote/place → thu → 4 công đoạn/giao → điểm/invoice; hẹn giờ/hủy/trả kho; counter/no-show; migration compiled apply/rerun giữ hash **31 collection fixture**, 0 JS exception/5xx. `.cache/pickup-lightpanda-20261020.mts`, `.cache/pickup-lightpanda-final.log`. Native datetime fill của Lightpanda không đồng bộ React nên harness dùng setter + DOM input/change; **chưa chứng minh datetime picker/dropdown native, CSS/layout trực quan, máy in hay điện thoại thật**.
- Local backup `.cache/maycafe-before-pickup-20261020.archive.gz`, apply migration 20261020-001, build/recreate stack healthy; PWA17, Guest `/pickup`, Staff `/staff/pickups`, Admin `/admin/pickups`. Hash/count **21 collection nghiệp vụ trước/sau migration và sau smoke bằng nhau**, `.cache/pickup-business-{before,after,final}.json`. Không seed/reset, không tạo giao dịch/khách/voucher/kho/QR mẫu hoặc đổi secret trên quán.
- Lightpanda read-only trực tiếp local PASS health/3 portal/PWA/API+SPA isolation, Guest menu→Mang đi→member gate, Staff/Admin login/nav/list/catalog/draft mở-đóng/history và workforce cũ; logout, không JS exception/5xx. `.cache/pickup-local-smoke-20261020.mjs`, `.cache/pickup-local-smoke.log`. Dọn browser/relay tạm, giữ app chạy; public tunnel dừng. OpenAPI parse 22 pickup paths PASS. Hướng dẫn `docs/pickup.md` có 14 kịch bản tự test.
- Dung lượng host: Docker build làm ổ C gần đầy; đã xóa **18,83 GB build cache có thể tái tạo** và TRIM Docker disk (~14,8 GiB). Windows vẫn chỉ báo khoảng **200 MB trống** do VHDX chưa thu nhỏ; chưa compact/restart Docker để giữ runtime đang phục vụ. Không xóa image/volume/database hay dữ liệu cá nhân. Đây là giới hạn vận hành còn cần xử lý, không phải lỗi test nghiệp vụ.

## Đồng bộ realtime #11 — 19/10/2026

- **346 PASS = 105 unit server + 166 integration + 75 client**; lint/typecheck/build PASS. Bao phủ invalidation đúng quyền, dedupe replay, rollback cả nghiệp vụ khi không ghi được outbox, copy một batch một event, Admin/Staff tự refetch, reconnect và tự chuyển tới ca ngoài tuần xem. Logs `.cache/workforce-realtime-{unit,integration-final,client,lint,typecheck,build}.log`.
- Lightpanda hai browser riêng + DB tạm: Admin tạo/sửa/hủy → Staff 202–242ms, Staff vào/ra → Admin 263–271ms; không reload/tải lại, không JS exception/5xx. `.cache/workforce-realtime-lightpanda.log`. Chỉ DOM/hành vi, CSS/layout/native dropdown/điện thoại thật chưa xác minh.
- Deploy local PWA16, toàn stack healthy; backup trước deploy, hash/count 21 collection nghiệp vụ không đổi. Smoke Lightpanda trực tiếp local PASS health/isolation/login/nav/report/CSV/privacy và thông báo qua outbox/Redis/worker/socket khiến Admin refetch 789ms, Staff 522ms. Chỉ tạo 2 outbox invalidation chẩn đoán, không sửa dữ liệu nghiệp vụ; smoke logout, browser/relay tạm dọn. `.cache/workforce-realtime-{docker,local-start,local-smoke}.log`, fingerprint `.cache/workforce-realtime-data-{before,after}.json`.

## Hoàn thiện #11 và cập nhật local — 19/10/2026

- **339 tests PASS: 105 unit server + 163 integration + 71 client**. Lint/typecheck/build PASS. Thêm 7 integration + 5 client cho copy preview/snapshot/transaction/conflict/rollback/race/replay, reset giờ công, lịch sử đủ mẫu/tuần 0/múi giờ/định mức, tổng đối soát hơn 50 dòng, CSV privacy/formula, UI gợi ý cần lưu/preview/copy retry/cash/CSV. Logs `.cache/workforce-complete-{unit,integration,integration-new,client,typecheck,lint,build}.log`.
- Lightpanda cô lập PASS các thao tác mới qua UI/API thật: chọn gợi ý lịch sử 24 đơn fixture, định mức3→2 người và lưu, xem biên bản ca tiền fixture, sao chép tuần có xem trước/chuyển đích/không mang giờ cũ, CSV response; cùng toàn luồng chấm công/KDS/correction trước đó. Hai migration compiled apply/rerun skip, hash 12 collection fixture không đổi; không JS exception/HTTP 5xx. Log `.cache/workforce-complete-lightpanda.log`.
- Runtime local đã backup `.cache/maycafe-before-workforce-complete-20261019.archive.gz`, build/recreate toàn stack, apply 003/004 chỉ thêm index, hash/count 21 collection nghiệp vụ trước/sau bằng nhau. Toàn stack healthy, migrate exit0, Guest8080/Staff8081/Admin8082 đang chạy. Logs `.cache/workforce-complete-{backup,docker-build,migration,local-start}.log`; fingerprint `.cache/workforce-complete-business-{before,after}.json`.
- Lightpanda read-only local PASS health/isolation/PWA15, đăng nhập/nav/tab/CSV/report riêng Admin và Staff, form cấu hình/copy mở rồi đóng; không ghi lịch/chấm/copy/policy hoặc đơn/khoản thu/kho thật, các phiên smoke đã logout. Log/harness `.cache/workforce-complete-local-smoke*`. Container browser/relay tạm đã dọn, giữ web chạy. OpenAPI YAML 13 path workforce/whitespace PASS.
- Giới hạn: Lightpanda chỉ chứng minh DOM/hành vi, chưa xác minh CSS/layout trực quan, dropdown native, mở CSV trong Excel hay điện thoại thật. `docs/workforce.md` có 16 kịch bản user tự test. Phạm vi được user chọn gồm bốn tiện ích bổ sung này, không gồm xin nghỉ/đổi ca duyệt hoặc tính lương. Chưa commit/push.

## Lịch ca, chấm công và hiệu suất (#11) — 19/10/2026

- **327 tests PASS = server 261 (105 unit + 156 integration), client 66**. Thêm 23 integration + 9 client; toàn suite từng nhóm PASS trên source cuối, lint/typecheck/build PASS. Logs `.cache/workforce-{unit,integration,integration-new,client,typecheck,lint,build}.log`. MongoMemoryReplSet riêng, TEMP/TMP `D:\codex-workforce-temp-20261019`.
- Integration: auth/admin/ownership và payload strict, ngày hợp lệ, giới hạn ca/qua đêm; tạo/sửa/hủy/replay/version; tranh ca giữa hai Admin, tranh policy đầu tiên; giờ server/window/duplicate punches, overlapping actual time và ca quên ra >24h; correction có lý do/giờ gốc, disabled/deleted; coverage minimum đồng thời/gap/disabled/present riêng; giờ cắt UTC+7; KDS actor/preparer/shift snapshot, review/sample counts/legacy không backfill, KDS đồng thời ra ca; rollback lịch/chấm công/audit và Order/activity/audit/outbox.
- Client: quyền riêng Staff/Admin, clock version, ca đang làm còn hiện ở tuần khác, giờ Việt Nam/qua đêm, retry giữ payload/key, stale correction không báo thành công, cấu hình thiếu người, missing samples; cache theo tài khoản và tạo UUID được khi không có crypto.randomUUID trên HTTP LAN.
- **Lightpanda cô lập PASS trên frontend build cuối**: tạo/sửa lịch, cấu hình nhu cầu và hiển thị thiếu, Staff chấm vào, 4 transition KDS thật, hiệu suất/sao từ Review fixture/số mẫu, chấm ra, Admin correction giữ giờ gốc + ca snapshot, hủy lịch có lý do; không JS exception/HTTP 5xx. Harness `.cache/workforce-lightpanda-20261019.mts`, log `.cache/workforce-lightpanda.log`. Select được chọn qua control DOM vì lookup wrapping-label của Lightpanda kèm text options; không dùng Chromium. DOM/hành vi **không chứng minh CSS/layout trực quan, dropdown native hoặc điện thoại thật**.
- Migration compiled `20261019-003-workforce-indexes` apply rồi rerun skip; hash dữ liệu 10 collection fixture trước/sau bằng nhau và đủ index unique WORKING/stage. OpenAPI YAML parse PASS (9 path mới), whitespace PASS. Hướng dẫn và 12 kịch bản tự test: `docs/workforce.md`.
- Runtime production-local đã dừng trước lượt này và được giữ nguyên; không rebuild/recreate hoặc chạy migration trên DB quán, không tạo ca/chấm/đơn/khoản thu thật, seed/reset, đổi QR/secret hoặc gọi AI live. Container Lightpanda tạm đã dọn. Bản #11 hiện có trong source, cần build/recreate stack trước khi tự test ở 8081/8082; chưa commit/push.

## Voucher dùng kèm điểm có điều kiện — 19/10/2026

- **295 tests PASS = server 238 (105 unit + 133 integration), client 57**. Lint/typecheck/build PASS, thêm 5 integration + 3 client so với bản #5 trước. Logs `.cache/promotion-stacking-{server,client,typecheck,lint,build}.log`.
- Kiểm thử trừ voucher trước, cap điểm 50% tiền còn lại (fixed/%/làm tròn/còn 0đ), legacy/default false, admin tắt quyền sau quote, tổng net và điểm tích, idempotency/rollback, hai đơn tranh lượt cuối không trừ điểm bên thua, hoàn cả điểm và lượt đúng một lần, snapshot hai khoản giảm trong Bill/receipt/in lại. Client giữ nguyên lựa chọn và cap sau voucher khi sửa điểm, hiển thị từ chối kết hợp, gửi cả hai cùng quote, checkbox admin được lưu.
- Tài liệu `docs/promotions-loyalty.md` đã cập nhật chính sách mới và 11 ca tự test. Các kết quả bên dưới về không cộng dồn thuộc bản trước, voucher cũ vẫn mặc định không kết hợp nếu admin chưa bật.
- Lightpanda cô lập PASS tạo/sửa quyền kết hợp, giỏ giữ hai lựa chọn và cap 25 điểm sau voucher10k/đơn60k, đặt đơn net40k, hủy hoàn cả hai, tắt quyền bị chặn mà không mất lựa chọn; không JS exception/5xx. Migration cũ apply/rerun vẫn PASS. Sau backup/build/recreate, local stack healthy và Lightpanda read-only PASS checkbox mới mặc định tắt (hủy form không lưu), member/admin navigation/API và 3 portal health/isolation. Không sửa dữ liệu quán; logs `.cache/promotion-stacking-{lightpanda,docker,local-start,local-smoke}.log`. Chưa xác minh CSS/layout, native dropdown, in giấy hay điện thoại thật; container trình duyệt tạm đã dọn.

## Voucher và thành viên theo SĐT + mật khẩu (#5) — 19/10/2026

- **287 tests PASS**: server 233 (105 unit + 128 integration), client 54. Mới thêm 19 integration và 6 client. Lint, typecheck, production build PASS. Logs `.cache/promotion-{server,client}-final.log`, `.cache/promotion-{lint,typecheck}-final.log`, `.cache/promotion-build.log`.
- Integration kiểm tra chuẩn hóa/hash/phiên HttpOnly/phân quyền/CSRF/lock login/revoke; quote gắn member/ưu đãi; min đơn/%/trần/thời hạn; tranh quota/điểm; rollback transaction; idempotency; thu từng phần/đủ không tích sớm; PAID+SERVED tích theo tổng net; hủy/hoàn/VOID; đơn 0đ; snapshot hóa đơn/receipt/in lại sau sửa mã. Database Mongo tạm, không ghi test vào quán.
- Client kiểm đăng ký/lỗi, lịch sử/logout xóa cache riêng, áp voucher chỉ gửi code + signed quote, đổi điểm không cộng dồn và chặn lỗi số dư, admin tạo mã có điều kiện và khóa member với observed version.
- Lightpanda trên DB cô lập PASS form tạo voucher, đăng ký, giỏ/đơn giảm giá, thanh toán/SERVED + tích điểm, đổi/hủy/hoàn điểm trên UI, lịch sử/khóa từ admin và đăng xuất khách; migration apply + rerun skip. Logs/harness `.cache/promotion-lightpanda-smoke*`. Giới hạn một context/page, kiểm tuần tự; không có bằng chứng CSS/layout, native dropdown, in giấy hoặc điện thoại thật.
- Hướng dẫn và 10 kịch bản user tự test: `docs/promotions-loyalty.md`. Không có SMS, không xác minh sở hữu SĐT; quên mật khẩu nhờ admin kiểm tra yêu cầu tại quầy rồi reset.
- Runtime local đã backup Mongo, build toàn stack, apply migration chỉ thêm indexes; hash 12 collection nghiệp vụ trước/sau migration không đổi. Web/4 API/3 worker/Mongo/Redis healthy, giữ chạy Guest 8080/Staff 8081/Admin 8082. Lightpanda read-only smoke local PASS member nav/login/register form, admin voucher/members nav và protected reads, 3 portal health và API isolation; không JS exception/5xx. Không tạo thành viên/voucher/đơn/thu tiền hay sửa QR/kho trên DB quán. Backup `.cache/maycafe-before-promotions-20261019.archive.gz`, logs `.cache/promotion-local-smoke.log`, `.cache/promotion-{docker-build,migration,local-start}.log`. Container Lightpanda/relay tạm đã dọn. OpenAPI YAML và whitespace PASS.

## Dữ liệu mẫu kho và hướng dẫn tự test — 19/10/2026

- Theo yêu cầu user, đã nạp API 32 nguyên liệu, 32 receipt tồn đầu, 22 recipe món và 6 recipe topping. Backup `.cache/maycafe-before-inventory-demo-20261019.archive.gz`; hash Order/Payment/Bill/Table/TableSession/Category trước/sau không đổi, các trường nghiệp vụ catalog giữ nguyên.
- Bộ nạp mặc định preview; đã chạy apply thành công rồi apply lại để kiểm idempotency: 0 ingredient/receipt/recipe mới, replay 32 receipt; đối chiếu toàn bộ số lượng và version recipe không đổi. Kiểm đọc `priceOrderItems` cho 30 cấu hình món/size/topping thật: đủ nguyên liệu và đúng tổng giá, không giữ/trừ tồn. Syntax `node --check scripts/setup-inventory-demo.mjs` và whitespace PASS. Không đổi code runtime nên không chạy lại suite đã đạt bên dưới.
- Dữ liệu `docs/data/inventory-demo.json`, tài liệu `docs/inventory-demo-data.md`, 12 ca tự test `docs/inventory-test-scenarios.md`. Các ca tạo đơn/thu/hoàn/pha chế được ghi là hướng dẫn để user tự chạy, không tính là manual PASS trên DB quán. Stack local giữ chạy; chưa xác minh CSS/layout mới ngoài các giới hạn Lightpanda đã ghi.

## Kho nguyên liệu và công thức — 19/10/2026

- **Runtime sau yêu cầu chạy test của user:** đã backup `.cache/maycafe-before-inventory-20261019.archive.gz`, build/recreate toàn stack production-local và apply migration inventory thành công; tất cả dịch vụ healthy, giữ chạy tại Guest 8080/Staff 8081/Admin 8082. Lightpanda smoke chỉ đọc PASS menu, login Staff/Admin, availability có effectiveAvailable, trang `/admin/inventory` và 3 tab, API kho 200 và chặn API Admin từ Guest; không JS exception/HTTP 5xx. DB có 0 nguyên liệu/0 công thức, không tự tạo fixture thật. Phiên smoke đã logout, container browser/relay tạm đã gỡ. Logs `.cache/inventory-local-start-20261019.log`, `.cache/inventory-local-smoke-20261019.log`. Chưa xác minh CSS/layout trực quan. Các ghi chú chưa cập nhật runtime bên dưới thuộc thời điểm hoàn tất source trước yêu cầu chạy.

- Lint/typecheck/build PASS. **262 tests PASS**: server unit 105, integration 109, client 48. Thêm 14 integration tests và 4 client tests. Logs `.cache/inventory-{lint,typecheck,build,unit,integration,client}-20261019.log`.
- Integration MongoMemoryReplSet riêng: phân quyền/strict validation, mã nguyên liệu unique, số lượng thập phân, nhập/xuất/kiểm kê và audit/ledger, version/idempotency và hai request cùng key; công thức/size/topping, cộng nhiều dòng chung nguyên liệu; hai bàn tranh phần cuối chỉ một thành công; replay không giữ hai lần; hủy/hoàn một phần trả giữ; PREPARING xuất đúng snapshot cũ và chỉ một lần; chặn giảm tồn dưới phần giữ/ngừng nguyên liệu còn giữ; rollback Order/Ingredient/ledger/outbox; giữ cờ ngừng bán thủ công và tương thích món/đơn chưa quản lý kho.
- Menu, featured, search, AI fallback, validate cấu hình và giỏ cũ đều chặn thiếu nguyên liệu; nhập tồn khôi phục khả năng bán. Client kiểm payload nhập kho/version/key, retry cùng payload sau mất mạng, công thức nền + size thay thế và tải lịch sử khi mở tab.
- Lượt `npm run test` đầu tiên chưa đạt: ổ C chỉ còn khoảng 50 MB khiến MongoDB tạm fassert, một test client cũ timeout khi chạy song song. Chuyển TEMP/TMP trong process test sang D và chạy từng nhóm; server unit 105, integration 109, client 48 đều đạt. Không đổi timeout để che lỗi.
- Lightpanda CDP trên image `lightpanda/browser:nightly`, frontend production build và DB tạm: login/menu Admin, thêm nguyên liệu và chọn đơn vị, nhập tồn, bật công thức/size, Staff badge thiếu nguyên liệu, lịch sử và menu khôi phục sau hủy PASS; không JS exception hoặc HTTP 5xx. Vì native selectOption chưa cập nhật trạng thái React trong Lightpanda, dropdown được kiểm bằng gán giá trị + dispatch DOM change và đối chiếu API/DB. **Chưa chứng minh thao tác dropdown native hoặc CSS/layout trực quan.** Harness/log `.cache/inventory-lightpanda-smoke-20261019.mts`, `.cache/inventory-lightpanda-20261019.log`.
- Migration compiled mới apply rồi skip idempotent trên DB tạm, số lượng Product/Ingredient không đổi. Không seed/reset DB quán hoặc cập nhật runtime production; stack local đang dừng từ trước lượt này. Không kiểm AI provider live. Hướng dẫn `docs/inventory.md`.

## Kiểm tra trước checkpoint Git — 16/10/2026

- Lint, typecheck và production build PASS. **200 tests PASS**: server unit 71, integration 85, client 44. Integration sử dụng database test cô lập; không seed/reset dữ liệu quán. Logs `.cache/git-push-{lint,typecheck,test,build}.log`.
- Kiểm tra whitespace và secret trong phần staged PASS; `.env`, `apikey.txt` và `.cache/` bị Git ignore.
- `npm audit --audit-level=high` FAIL: **15 vulnerabilities (2 moderate, 12 high, 1 critical)** trên dependency hiện có. Package manifests/lockfile không thay đổi trong checkpoint; chưa thực hiện nâng dependency. CI có bước audit nên có thể thất bại. Log `.cache/git-push-audit.log`. Kết quả audit 0 trong các mục lịch sử không đại diện cho lần kiểm tra này.
- Sau khi áp dụng cấu hình AI mới: 4 API và 3 worker healthy, các biến AI runtime khớp `.env`, `AI_MODE=live`; chưa gọi thử provider. Local health ở 8080/8081/8082 và public menu/products/health HTTP 200; link public hiện tại lưu trong `.cache/public-url.txt`.
- Không chạy lại browser suite trong lần checkpoint này; bằng chứng browser ở các mục dưới thuộc các lần kiểm tra trước.

## Public Guest HTTPS — 15/10/2026

- Web Docker build/TypeScript và client lint PASS; client **44 tests PASS**, gồm 2 test runtime portal identity. Nginx -t PASS. Hai Guest APIs có PUBLIC_APP_URL=https public và COOKIE_SECURE=true, hai Internal APIs giữ HTTP local cookie false.
- Cloudflare tunnel chuyển đúng Guest 8080; HTTPS/menu/API public HTTP 200. Browser mobile secure context, guest portal meta, menu và WebSocket handshake PASS. Negative join nhận đúng lỗi vé đầu vào thay vì CSRF origin; token màn hình sai bị chặn. Public /auth/login, /staff, /admin và API nội bộ trả 404; local 8081/8082 healthy và hiển thị đăng nhập.
- User tự chọn bàn; không cấp lại khóa màn hình, tạo phiên/đơn/khoản thu hoặc reset database. Camera/4G trên điện thoại thực tế chưa được kiểm tra. Ảnh `.cache/public-browser/menu-phone.png`; logs `.cache/public-{web-build,client-tests,lint,start,production}.log`.

## Tài khoản, topping và khoản thu — 15/10/2026

- Typecheck/lint/build PASS; **198 tests PASS**: server unit 71, integration 85, client 42. Logs `.cache/account-{tests,typecheck,lint,build}.log`.
- Tài khoản: profile chỉ trả trường an toàn; nhân viên chỉ sửa tên mình, không đổi quyền hay quản lý người khác; mật khẩu hiện tại sai bị chặn, đổi đúng thu hồi access/refresh; admin tạo/sửa/khóa/mở/đặt lại mật khẩu, validate email/quyền/ID, chặn cập nhật tùy ý và tự khóa/hạ quyền. Hai admin hạ quyền nhau đồng thời chỉ một thao tác thành công; token cũ không version còn dùng trước lần thay đổi bảo mật đầu tiên.
- Làm rõ giao diện: bấm tên người dùng mở profile; menu giữ Nhân viên và các mục nghiệp vụ. Xóa nhân viên chỉ ADMIN xóa STAFF, ẩn khỏi list, chặn login/access/refresh và mở khóa lại bằng PATCH; payment snapshot và tên người thu được giữ nguyên. Client kiểm hủy/xác nhận xóa nhân viên. Các kiểm thử nằm trong accountCatalog.test.tsx và accounts.test.ts.
- Topping: chỉ admin xóa mềm/khôi phục, invalid ID bị chặn, menu loại topping đã xóa, cấu hình AI và giỏ cũ không chấp nhận, snapshot đơn giữ nguyên, audit/outbox đầy đủ.
- Client: sửa tên/đổi mật khẩu và đăng xuất, khóa mình bị vô hiệu và khóa người khác cần xác nhận, hủy/xác nhận xóa topping/khôi phục, mã khoản thu ẩn mặc định trong Chi tiết nhưng vẫn mở được.

- Production-local đã cập nhật toàn stack, mọi dịch vụ healthy. Chromium PASS 18 màn hình ở 375/768/1440 trên hai portal: trang tài khoản, sửa tài khoản Admin, xác nhận xóa topping và khoản thu gọn; không tràn ngang hoặc page error. Mọi hộp sửa/xóa đều hủy; users và topping nghiệp vụ không đổi. Ảnh `.cache/account-browser/`, log `.cache/account-production.log`.

- Bản giao diện làm rõ đã triển khai, mọi dịch vụ healthy. Chromium PASS 9 màn hình profile/xác nhận xóa nhân viên ở 375/768/1440, bấm tên người dùng mở profile và đăng nhập/đăng xuất cho Admin/Staff, route bảo vệ sau logout và refresh 401; các menu tài khoản mới được bỏ. Hủy xóa, users không đổi; không tràn ngang/page error. Artifacts `.cache/profile-browser/`, `.cache/profile-production.log`; typecheck/lint/build và 198 tests PASS, logs `.cache/profile-*.log`.

## Xóa catalog và lọc theo danh mục hiển thị — 13/10/2026

- Server unit **71 PASS**, integration **75 PASS**, client **37 PASS**; tổng **183**. Typecheck/lint/build toàn repo PASS. Thêm 8 integration tests trong `catalogLifecycle.test.ts` với Mongo replica set cô lập.
- Kiểm xóa mềm/khôi phục món giữ nguyên paid order/payment snapshot; ẩn/hiện danh mục áp dụng menu/featured/search/AI/cấu hình AI/giỏ cũ; count tính archive; chuyển toàn bộ món rồi xóa category có audit/outbox, rollback nhận sai/trùng, ADMIN authorization, tạo/chuyển món đồng thời không orphan.
- Browser cô lập PASS xác nhận/hủy xóa, archive/restore, form category đúng và giữ ingredient/options/variant, hide/show cập nhật guest qua realtime, xóa danh mục sau chuyển và xóa danh mục trống. Ba viewport 375/768/1440 không tràn ngang/page error. Không ghi dữ liệu thử vào DB quán. Artifacts `.cache/catalog-browser/`.
- Đã build/recreate toàn stack local, mọi API/workers/web/Mongo/Redis healthy; không cần schema migration mới, không seed/reset. Logs `.cache/catalog-{unit,integration,client-tests,typecheck,lint,build,browser,docker-build,deploy}.log`. Hướng dẫn `docs/catalog-lifecycle.md`.
- Smoke production chỉ đọc PASS Admin xác nhận xóa món/danh mục ở 3 kích thước, số món từng danh mục khớp danh sách admin, menu khách và health 3 portal; tất cả hộp thoại được hủy, so sánh catalog trước/sau không đổi. Không tạo đơn/khoản thu. Log `.cache/catalog-production.log`, ảnh `.cache/catalog-production/`.

## Đồng bộ cửa sổ và giao diện khách — 13/10/2026

- Client typecheck/lint/build PASS, 37/37 tests PASS. Theme khách xanh đậm/chữ sáng/vàng; AI, tùy chỉnh món, bộ lọc, giỏ/đơn, hủy/đánh giá và vào bàn đồng bộ. Staff/Admin tiếp tục nền kem, in hóa đơn nền trắng/chữ đậm; PWA cache v6.
- Chromium với API + Mongo replica set cô lập PASS: preset/ngân sách/không sữa → gọi AI thật ở mode fallback → xem thẻ gợi ý/mở cấu hình; đặt Espresso 35k → thu 10k + 25k → KDS phục vụ → gửi đánh giá → đóng phiên/receipt. Ba kích thước 375/768/1440 cho AI, options, cart, orders, cancel/review/receipt; kiểm nút đóng trong viewport, không tràn ngang/page error và màu chữ/nền khi print. Các giao dịch thử chỉ nằm trong DB cô lập.
- Docker web đã cập nhật, toàn stack healthy. Smoke read-only production PASS menu, AI 3 kích thước/Escape, chọn món/filter/vào bàn; Staff/Admin không nhận theme khách. Không tạo phiên/đơn/khoản thu trên DB quán. Logs `.cache/guest-surfaces-{typecheck,lint,tests,build,browser,production,docker-build,deploy}.log`, ảnh trong `.cache/guest-surfaces-browser/` và `.cache/guest-surfaces-production/`.

## Thực đơn ảnh nền và carousel — 13/10/2026

- Checkpoint `9c27792` đã push lên origin/main trước khi sửa UI theo yêu cầu.
- Client typecheck/lint/build PASS; **37 tests PASS**. Ba test mới kiểm preview không gọi đặt món, chuyển đúng món sang phần tùy chỉnh, thay danh sách lọc không giữ món ngoài kết quả và chặn chọn món tạm hết.
- Chromium với API và Mongo replica set cô lập, catalog sao chép từ API đọc: PASS tại 1440/1920/768/390/375, không tràn ngang/lỗi JS. Bấm thẻ đổi đúng URL ảnh, heading, mô tả và giá, không mở modal/gửi đơn; next/previous, danh mục, tìm kiếm tiếng Việt không dấu, kết quả rỗng, ảnh URL không hợp lệ và AI dialog đều hoạt động.
- Luồng **Chọn món → tùy chỉnh → thêm giỏ → quote → đặt đơn** PASS, tạo một đơn Espresso Mây 35.000 VND, AWAITING_PAYMENT/UNPAID trong DB cô lập. Không đặt/thu tiền thử trên DB quán.
- Artifacts: `.cache/showcase-browser.log`, `.cache/showcase-browser/`, `.cache/showcase-tests.log`, `.cache/showcase-typecheck.log`, `.cache/showcase-lint.log`, `.cache/showcase-build.log`.
- Web local đã cập nhật và healthy. Smoke production chỉ đọc PASS tại 1440/768/375, ảnh nền local/mô tả/modal hoạt động, Staff/Admin giữ layout riêng, không lỗi JS; không tạo phiên/đơn/khoản thu. Log `.cache/showcase-production-smoke.log`, ảnh `.cache/showcase-production/`.

## Fantastic cafe và Be Vietnam Pro — 13/10/2026

- Đổi tên trên ba portal, đăng nhập, QR, hóa đơn/in, tab/meta/PWA và CSV. Cả ba giao diện dùng font Be Vietnam Pro, có WOFF2/OFL local và precache service worker phiên bản mới.
- Build/lint PASS. Chromium production-local kiểm tra 54 màn hình: Staff/Admin đăng nhập và các route, Khách tại 375/768/1440; tên đúng, font thật tải thành công, không tràn ngang, không page error. PWA dùng tên mới và font tiếng Việt vẫn tải từ cache khi offline.
- Đã cập nhật toàn bộ API/workers/web local, mọi dịch vụ healthy. Kiểm tra chỉ đọc, không tạo/sửa đơn, khoản thu hoặc dữ liệu menu. Artifacts `.cache/fantastic-browser.log`, `.cache/fantastic-browser/`, `.cache/fantastic-build.log`, `.cache/fantastic-lint.log`, `.cache/fantastic-deploy.log`.

## Thu từng phần, quyền thu và điều chỉnh — 13/10/2026

- Server unit: 71 PASS. Client: 34 PASS. Integration: 67 PASS (12 kiểm thử bổ sung cho nghiệp vụ thanh toán).
- Kiểm chứng có hai tài khoản STAFF tranh quyền cùng bàn, người thua không thu/trả quyền người khác được; hết hạn cho phép nhận quyền mới và chặn chủ cũ.
- Thu thiếu/nhiều đợt, số dư guest/bill/ca đúng, KDS chờ đủ tiền; chặn thu vượt và hủy trực tiếp sau nhận tiền; hoàn nhiều khoản và hoàn theo yêu cầu hủy sau thu một phần.
- VOID/METHOD/TRANSFER cần ADMIN khác duyệt; hai quản lý duyệt đồng thời chỉ một lần ghi đảo; giữ khoản thu gốc và Bill đóng phiên bất biến; từ chối mở lại thao tác; phân quyền lịch sử/duyệt.
- Báo cáo theo ngày thu/hoàn, phân biệt hoàn thực tế và điều chỉnh; ngày chỉ hoàn tiền có thực thu âm. Chốt ca bắt buộc lý do chênh lệch và chặn lúc đang giữ quyền thu.
- Lint, typecheck và build PASS. Chromium với API/Mongo replica set cô lập PASS luồng thu 10.000 + 25.000 VND, guest thấy số còn thiếu, staff gửi sửa phương thức, admin duyệt, KDS phục vụ và đóng phiên; thực thu ròng 35.000 VND. Sáu màn hình khoản thu tại 375/768/1440 không tràn và không lỗi JS. Dữ liệu quán đang chạy không dùng để đặt/thu/hoàn thử.
- Smoke đã phát hiện cleanup HTTP có thể bị hủy khi điều hướng ngay sau xác nhận; server nay trả quyền trong transaction khi ghi nhận khoản thu/hoàn/thu gộp, có assertion kiểm quyền đã xóa sau commit.
- Artifacts: `.cache/payment-integration.log`, `payment-unit.log`, `payment-client.log`, `payment-typecheck.log`, `payment-lint.log`, `payment-build.log`, `payment-browser.log`, ảnh `.cache/payment-browser/`.
- Đã backup dữ liệu vào `.cache/maycafe-before-payment-safeguards.archive`, build/recreate toàn stack production-local và chạy migration index thành công (exit 0). Mongo/Redis, 4 API, 3 worker và web đều healthy; không seed/reset. Smoke production kiểm ba portal, login Staff/Admin, hai trang Khoản thu, phân quyền, công thức báo cáo và responsive PASS; không tạo/sửa đơn hay khoản thu trên dữ liệu quán. Integration 67 và server typecheck/lint chạy lại sau hai chốt chặn cuối đều PASS.

## Thiết kế theo repo cho Khách/Staff/Admin — 13/10/2026

- Client typecheck, lint, build và Docker web build PASS; client **32/32** test PASS. Lần này thay đổi frontend và tài liệu; không đổi backend/model/schema nghiệp vụ.
- Browser với production client, API/Mongo replica set cô lập và catalog đọc từ public API thật PASS luồng QR → đặt/thu tiền/phục vụ → đánh giá A → gọi thêm/đánh giá B → đóng phiên/in/receipt. Kiểm tra menu và các trang Staff tại 390/768/1440 không tràn ngang; không có page error. Chỉ tạo đơn/khoản thu/đánh giá thử trong database cô lập.
- Audit trực tiếp bản Docker mới: **45 tổ hợp trang/kích thước** (14 trang Staff/Admin và trang vào bàn, mỗi trang tại 375/768/1440) PASS không tràn ngang/page error; đăng nhập/đăng xuất Staff/Admin PASS. Audit production không tạo/sửa đơn, thanh toán, đánh giá hoặc catalog.
- Đã xem ảnh trước/sau của các portal, menu, KDS có đơn và trang bàn trên mobile. Bản web mới healthy, API/Mongo/Redis/workers vẫn healthy.
- Tài liệu nguồn/nhận diện/file/mục tiêu: `docs/design-context.md`. Logs `.cache/design-typecheck.log`, `design-lint.log`, `design-client-tests.log`, `design-build.log`, `design-runtime.log`, `design-responsive.log`; ảnh `.cache/design-before/`, `.cache/design-after/`, `.cache/design-runtime/`.

## Đánh giá từng đơn trong phiên đang mở — 13/10/2026

- Lint, typecheck và production build PASS. Server unit **71/71**, client **32/32**, integration **55/55** (tổng **158/158**).
- Client kiểm tra chỉ cho đánh giá SERVED/PAID chưa đánh giá; đơn A và B được đánh giá riêng trong cùng phiên; cache/refetch giữ đánh giá; lỗi mạng giữ nhận xét để thử lại; receipt giữ đánh giá cũ và chỉ cho đánh giá đơn còn thiếu.
- Integration với Mongo replica set thật kiểm tra đánh giá trước khi đóng không tạo Bill/không đóng phiên, vẫn tạo đơn tiếp; GET list/detail trả đúng summary; thiết bị khác bị chặn; chưa phục vụ/chưa trả tiền bị chặn; gửi đồng thời cùng đơn chỉ một 201, còn lại 409; receipt giữ đánh giá sau đóng và không nhận đánh giá trùng.
- Chromium trên production client + API/Mongo cô lập PASS luồng đặt/thu tiền/phục vụ A → đánh giá A khi OPEN → gọi thêm/thu tiền/phục vụ B → đánh giá B khi OPEN → reload → đóng phiên → receipt giữ cả hai đánh giá, không page error. Ảnh tại `.cache/order-reviews-browser/`.
- Log `.cache/order-reviews-client.log`, `order-reviews-unit.log`, `order-reviews-integration.log`, `order-reviews-typecheck.log`, `order-reviews-lint.log`, `order-reviews-build.log`, `order-reviews-browser.log`. Không tạo đánh giá thử trên dữ liệu quán.
- Đã build/recreate toàn bộ production-local, tất cả dịch vụ healthy và migrate exit 0. Smoke ba portal, login Staff, API chờ thanh toán/KDS và route isolation PASS; asset OrderReview mới trả 200. Log `.cache/order-reviews-production-smoke.log`. Không reset/seed dữ liệu.

## QR động và thanh toán trước — 12/10/2026

| Kiểm tra                                                   | Kết quả                                                                                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                             | PASS                                                                                                                                                                 |
| `npm run typecheck`                                        | PASS                                                                                                                                                                 |
| `npm run build`                                            | PASS                                                                                                                                                                 |
| `npm test`                                                 | PASS: server unit 71, client 28, integration 53; tổng 152/152                                                                                                        |
| `docker compose -f compose.production.yaml config --quiet` | PASS, dùng `.env` hiện có                                                                                                                                            |
| Chromium + MongoDB replica set cô lập                      | PASS luồng giao diện đặt món → chờ tiền → Staff xác nhận → KDS → gọi thêm trả tiếp → đóng phiên → hộp hóa đơn in → guest receipt; không page error                   |
| Docker production-local rebuild và smoke                   | PASS: Mongo/Redis, 4 API, web, 3 worker healthy; migrate exit 0; 3 portal, login Staff, API chờ tiền, KDS chỉ PAID, route isolation và UI mới đúng; không page error |

Các ca mới kiểm tra chữ ký/hạn QR/QR tĩnh bị từ chối, hai participant chung phiên, thu hồi khóa và QR, đơn chưa trả tiền không vào KDS, phiên vẫn mở sau thu tiền, chống thu trùng đồng thời cùng/khác idempotency key, giới hạn 3 đơn chờ, hủy/hoàn tiền và tiền mặt ca, chốt hóa đơn bất biến khi đóng. Client kiểm tra xoay mã sau 60 giây, ẩn QR khi offline, retry tiền cùng key, không đóng khi đang pha và giữ hộp hóa đơn khi thẻ bàn bị loại sau đóng.

Log: `.cache/prepay-tests-final.log`, `.cache/prepay-build.log`, `.cache/prepay-lint.log`, `.cache/prepay-typecheck.log`, `.cache/prepay-browser.log`. Ảnh đã xem: `.cache/prepay-browser/display.png`, `guest-awaiting.png`, `closed-bill.png`; có thêm ảnh Staff nhận tiền và KDS. Smoke dùng build production của client, API thật, MongoDB cô lập; không thay đổi dữ liệu quán. Chưa thử camera/4G/máy in thật, Firefox/WebKit hoặc benchmark lại. Workload k6 đã đổi để lấy QR mới và hủy đơn chờ, nên số đo lịch sử bên dưới không áp dụng trực tiếp.

Các mục sau là kết quả lịch sử trước khi chuyển luồng.

Production-local dùng `.env` hiện có, không reset/seed dữ liệu. Smoke production chỉ đọc dữ liệu nghiệp vụ (có login), không tạo/sửa đơn hoặc khoản thu. Log `.cache/prepay-docker.log`, `.cache/prepay-production-smoke.log`; ảnh `.cache/prepay-browser/production-staff.png`. Staff/Admin cần cấp liên kết màn hình cho từng bàn trước khi sử dụng QR mới.

## Kết quả đã chạy

| Kiểm tra                                  | Kết quả                                                             |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `npm run lint`                            | PASS — server và client, 0 lỗi/0 cảnh báo                           |
| `npm run typecheck`                       | PASS — client, server, contracts                                    |
| `npm run test:server`                     | PASS — 69/69 unit test trên 12 file                                 |
| `npm run test:client`                     | PASS — 19/19 test trên 4 file                                       |
| `npm run test:integration`                | PASS — 46/46 test trên MongoMemoryReplSet tạm                       |
| `npm run test:queue-drill`                | PASS — isolation, reclaim, owner ACK và dead-letter replay          |
| `npm run test:e2e` (frontend preview mới) | PASS 7, SKIP 4 cần API/token — responsive và PWA offline reload đạt |
| `npm run build`                           | PASS — contracts, server và client production build                 |
| `docker compose ... config --quiet`       | PASS — migration gate và ba worker role hợp lệ                      |
| `npm audit`                               | PASS — 0 vulnerability                                              |

Route-level code splitting giữ entry client ở 389,20 kB, gzip 118,78 kB. Chunk lớn nhất là Dashboard 384,70 kB, gzip 102,48 kB; build không còn cảnh báo chunk lớn hơn 500 kB.

## Sửa lỗi S1–S4 (`claude_de_xuat.md`) — 24/09/2026

Mỗi lỗi có test tái hiện chạy đỏ trên code cũ trước khi sửa:

| Mã  | Test                                                                       | Trước khi sửa                    | Sau khi sửa                               |
| --- | -------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------- |
| S1  | `lists only unfinished orders of active visits in the staff feed`          | feed trả cả đơn phiên đã đóng    | chỉ đơn chưa xong của phiên OPEN/CHECKOUT |
| S2  | `replays an order when the same key races past the idempotency pre-check`  | 409 CONFLICT                     | 200, `created:false`, 1 đơn               |
| S2  | `replays a payment when the same key races past the idempotency pre-check` | 403 "chuyển bàn sang thanh toán" | 200, `replayed:true`, 1 Payment, 1 Bill   |
| S2  | client `keeps the order key after $code only when the order may exist`     | giỏ đổi key sau mọi lỗi 4xx      | chỉ đổi key khi `IDEMPOTENCY_CONFLICT`    |
| S3  | `never exposes internal order fields to guests or staff`                   | lộ `idempotencyKey`              | DTO `guestOrderSchema`/`staffOrderSchema` |

S4 kiểm tra trên production-local (image `web` build từ HEAD `4e017b0` để khớp backend đang chạy, kèm cấu hình Nginx mới):

- gzip: entry JS 389.784 → 118.605 byte; `/api/v1/categories` 22.804 → 3.451 byte.
- Header `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, `Content-Security-Policy` (enforce) có ở `/`, deep link, `/assets/*`, `/sw.js`; `index.html`/`sw.js` `Cache-Control: no-cache`. API chỉ mang header của helmet.
- Duyệt ba portal bằng Chromium (khách, staff đăng nhập + KDS/bàn/hết món/ca, admin đăng nhập + dashboard/món/bàn/operations/hóa đơn + mở dialog): 0 vi phạm CSP, 0 lỗi console. `npm run test:e2e`: 7 PASS, 4 SKIP (thiếu `E2E_TABLE_TOKEN`).

## Dựng lại production-local từ source hiện tại — 24/09/2026

- Backup `maycafe` trước khi nâng cấp (mongodump gzip + SHA-256), ghi số document trước/sau: không đổi.
- `migrate` exit 0: áp dụng `20260923-001..003`, lần chạy lại đều `skip`.
- 11 container healthy; health trả `trafficClass` guest/internal đúng cổng; gọi chéo portal trả 404; ba worker ghi heartbeat.
- Duyệt ba portal: phát hiện `GET /admin/bills` 422 với bộ lọc rỗng → sửa contract, test `billHistoryQuery.test.ts`, build lại; sau đó 0 lỗi console, 0 vi phạm CSP. `npm run test:e2e`: 7 PASS, 4 SKIP.

## Phạm vi bằng chứng

- Unit server: crypto/token, request ID an toàn, controller tiêu thụ contract auth/payment, health/readiness và HTTP shutdown.
- Unit observability: route template không lộ ID/URL thật, HTTP metrics, socket gauge, business counter và thời gian công đoạn.
- Unit tìm kiếm P4A: 25/25 ca; 13/13 truy vấn Top-1 định trước và 12/12 ca ràng buộc về phủ định, budget biên, metadata, hết món/size, typo và kết quả rỗng.
- Unit anomaly P4B: normal, spike 5xx, HTTP p95, pha chế p95, hủy tăng, ít mẫu và provider timeout; 4/4 anomaly đúng, 0/4 false alert ở window normal.
- Client: checkout/review, QR auto-open, refresh token single-flight và realtime event gate; bao gồm retry một lần, refresh đồng thời, refresh lỗi, race logout, giữ `Idempotency-Key`, loại event trùng/cũ và chấp nhận version gap để refetch snapshot.
- Integration: hai khách cùng bàn, ownership, giá server-side, idempotency, state machine, thanh toán, Bill/receipt/review, Socket.IO, phiên QR tự mở/idle sweeper, tìm kiếm menu và anomaly ADMIN/dedupe/audit trên MongoDB thật.
- Transactional outbox: rollback đồng thời business record/audit/event; replay order/payment không sinh thêm event; realtime lifecycle vẫn đến đúng room và sự kiện thanh toán đến trước khi socket phiên bị ngắt.
- Quote/receipt/workflow: quote hết hạn, đổi số lượng/catalog/topping hoặc dùng sai participant đều bị từ chối; Bill snapshot không đổi khi Order bị sửa và receipt cũ vẫn fallback; cấu hình AI cuối chặn topping/variant không hợp lệ, caffeine, sữa và vượt ngân sách.
- Race/failure workflow: hai cập nhật trạng thái, hai yêu cầu hủy, hai lần chuyển cùng bàn đích, payment so với đóng ca và hai lần đóng ca đồng thời đều chỉ cho một kết quả hợp lệ; checkout có yêu cầu hủy chờ duyệt bị chặn; phân trang 105 Bill và phân quyền Admin được kiểm tra.
- Redis drill trên container cô lập: report đang giữ lease không chặn realtime; foreign ACK bị từ chối; job được reclaim sau lease; dead-letter replay đúng queue; cuối bài cả realtime/report pending/processing và dead-letter đều bằng 0.
- Migration/restore drill trên MongoDB 7 cô lập: runner production apply rồi skip idempotent cả 3 migration; archive SHA-256 khôi phục 4 business document và migration state, không Bill trùng phiên, không Payment mồ côi và không thiếu 5 index bắt buộc.
- Integration chỉ dùng database tạm do `mongodb-memory-server` tạo; không seed hoặc xóa database demo của người dùng.
- Dashboard aggregation được kiểm tra với 105 đơn PAID để bảo đảm không bị giới hạn phân trang 100; lọc ngày dùng múi giờ `Asia/Ho_Chi_Minh`.

## Browser/responsive QA

- Playwright chạy trên production frontend vừa build qua Vite preview cô lập tại `http://127.0.0.1:4173`.
- Ở 375×812, 768×1024 và 1440×900: trang nhập QR và form đăng nhập hiện control chính, không tràn ngang, không có uncaught page error.
- Suite có 11 ca. Lượt ngày 23/09 đạt 7 ca không cần backend, gồm reload PWA khi offline rồi nhận trạng thái kết nối lại; 4 ca menu/hai thiết bị được ghi SKIP vì không truyền `E2E_TABLE_TOKEN` vào lượt preview này.
- Runtime Browser tích hợp ban đầu không khởi tạo được kernel assets (`os error 3`), nên dùng Playwright trong repo làm fallback có thể tái chạy. Không coi đây là kiểm tra trực quan thủ công trên nhiều browser engine.

## Production container — đã kiểm chứng 23/09/2026

- Docker Engine 29.7.2: build thành công image Node.js 24 LTS và Nginx 1.27.
- `mongo`, `redis`, `server-guest-a/b`, `server-internal-a/b`, `web`: healthy; `worker` chạy entrypoint job riêng trong project Compose `maycafe-production`.
- HTTP được tách portal: Guest `8080`, Staff `8081`, Admin `8082`; deep-link đúng portal trả 200. Ma trận smoke xác nhận route/API gọi chéo trả 404, còn API đúng portal vẫn áp dụng 401/403 theo JWT/role.
- Staff/Admin login qua origin riêng trả 200 và dùng hai cookie `mc_refresh_staff`/`mc_refresh_admin`, không ghi đè nhau trên cùng host.
- Health API xác nhận `8080 → trafficClass=guest`, `8081/8082 → trafficClass=internal`. Docker inspect xác nhận mỗi API giới hạn 0,75 CPU/384 MiB; Internal có `cpu_shares=1536`, Guest `512`.
- Menu public sinh cache key Redis. Burst 100 request Guest cho 22×200 và 78×429, không có 5xx; join cùng token thử nghiệm cho 20×404 và 2×429, chứng minh limiter shared theo token bàn.
- Worker hoàn tất report JSON (17 ngày dữ liệu) và CSV (859 ký tự); realtime smoke job được xử lý với queue/processing/dead-letter đều về 0.
- `/readyz` trong backend trả 200 với MongoDB `ready`; WebSocket kết nối qua Nginx bằng transport `websocket`.
- Luồng production-local đạt: QR join → order → bốn trạng thái → checkout → payment → Bill snapshot → receipt đúng tổng tiền.
- SIGTERM: server exit code 0 sau khoảng 495 ms và healthy lại sau restart.
- P3: raw metrics chỉ truy cập nội bộ; Admin operations đúng quyền. Lỗi kiểm soát 404 được đối chiếu cùng requestId trong log và làm client-error counter tăng đúng một.
- Seed và luồng kiểm tra chỉ dùng volume production-local riêng; không ghi vào database dev/demo hiện có.
- P5A baseline cũ: REST chia 10/10 qua hai backend; shared limiter, cross-instance Socket và failover đều PASS. Topology hiện đã đổi sang hai pool, nên số failover cũ không được dùng để khẳng định hiệu năng pool mới.
- P5B baseline trước khi tách pool: fixed menu đạt đến 90 RPS (p95 96,48 ms), không đạt từ 100 RPS và không đạt mục tiêu ramp 600–700. Guest 20 VU không lỗi dữ liệu nhưng write p95 4,15 giây, vượt ngưỡng 1 giây. Realtime 100/100 kết nối, p95 324,05 ms. Chưa chạy lại k6 đầy đủ sau thay đổi; chi tiết ở `performance-report.md`.
- Load test phát hiện benchmark seed làm mất unique index sau `dropDatabase`; đã sửa seed dựng lại index. Lượt chính thức sau sửa giữ đúng một phiên active cho 20/100 guest đồng thời và không dùng số liệu cũ bị sai bất biến.
- AI live smoke gửi ba recommendation + một anomaly explanation nhưng provider trả 401; bốn ca fallback an toàn. Chưa có bằng chứng AI live hợp lệ.

## Chưa kiểm chứng

- Quét QR bằng camera thật và in QR thực tế.
- AI live hợp lệ: key hiện tại bị provider từ chối 401; cần key mới rồi chạy lại smoke test.
- Cloud deployment và HTTPS thật. GitHub Actions run #1 trên commit `b61a8f0` đã PASS cả ba job; đây không phải bằng chứng cloud runtime.
- Quét trình duyệt khác Chromium, network throttling chi tiết và rà soát trực quan bằng mắt vẫn là bước bổ sung.
- Ca browser hai thiết bị vẫn skip vì chưa truyền `E2E_TABLE_TOKEN`; ownership/hai participant vẫn được integration MongoDB thật bao phủ. Docker production-local đang chạy.
