# Bộ nhớ dự án — Fantastic cafe

Cập nhật: 16/10/2026.

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
