# Tặng quà cho bàn khác (#1)

## Chọn ẩn danh hoặc hiện bàn gửi — 22/10/2026

Trước khi gửi lời mời, người gửi chọn **Ẩn danh** (mặc định) hoặc **Hiện bàn gửi**. Mỗi quà có lựa chọn riêng và giữ nguyên sau khi gửi. Sau một lần gửi thành công, bản nháp tiếp theo trở về Ẩn danh; nếu mất phản hồi/reload, Thử lại giữ đúng lựa chọn ban đầu.

Hiện bàn gửi chỉ công khai **tên và mã bàn gửi** cho phiên nhận, lấy từ phiên thực tế ở server và lưu snapshot lúc gửi. Bàn nhận thấy `Quà từ <mã> · <tên bàn>`; không thấy tài khoản, participant/session, số điện thoại hoặc thông tin tài chính. Các dòng dưới đây nói về ẩn danh áp dụng khi chọn Ẩn danh. Quà cũ thiếu lựa chọn vẫn ẩn danh, không backfill hoặc tự bật hiển thị; tên/mã bàn đã hiện không đổi khi bàn được đổi tên sau đó.

API POST `/gifts` thêm boolean `showSenderTable`, mặc định false. GiftView có boolean này, chỉ có `senderTable:{name,code}` khi người gửi chọn true. Không nhận tên/mã bàn tự khai trong request; đổi lựa chọn nhưng dùng lại requestId cũ trả IDEMPOTENCY_CONFLICT. Retry pending ẩn danh từ bản trước vẫn hoạt động. Realtime chỉ báo refresh, thông báo chung là “Bàn bạn có quà mới”. Không đổi luồng nhận/đặt/thu tiền/kho/hóa đơn.

Tự kiểm thêm: (1) mặc định Ẩn danh; (2) chọn Hiện bàn gửi, phía nhận thấy đúng tên/mã bàn thực tế; (3) quà tiếp theo mặc định lại ẩn và không lộ bàn gửi; (4) mất phản hồi/reload giữ nguyên chế độ, không gửi trùng; (5) quà cũ tiếp tục ẩn, thay chế độ trên cùng requestId bị từ chối. Lightpanda chỉ kiểm DOM/hành vi, chưa chứng minh bố cục trực quan trên điện thoại.

Khách đã quét QR vào phiên bàn đang OPEN mở **Tặng quà** (`/gifts`). Chọn bàn nhận trên sơ đồ thẻ bàn, chọn món trong menu và tùy chỉnh size/đường/đá/topping như đặt món thường; có lời nhắn tối đa 140 ký tự. Giỏ quà riêng, không sửa giỏ tại bàn hoặc giỏ mang đi. Bàn chưa có phiên OPEN và guest capability còn hạn bị vô hiệu hóa. Đây là danh sách bàn có khả năng nhận, không phải sơ đồ vị trí vật lý hay bằng chứng khách còn ngồi tại quán.

## Luồng và thời hạn

1. **Gửi lời mời**: PENDING trong 5 phút. Chưa có Order, giữ kho, voucher, điểm hoặc khoản thu.
2. Bất kỳ thiết bị QR hợp lệ của **đúng phiên bàn nhận** có thể **Nhận quà / Từ chối**. Quyết định đầu tiên thắng. Bàn nhận chỉ thấy món, tùy chọn, lời nhắn và trạng thái; không thấy bàn/người gửi, participant/session của người gửi, request key, giá, ưu đãi hay mã đơn tài chính.
3. Nhận → ACCEPTED và mở thêm 5 phút cho người gửi xác nhận. Người gửi có thể hủy lời mời khi PENDING/ACCEPTED. Bàn nhận không đổi quyết định sau khi đã nhận; liên hệ nhân viên nếu cần xử lý.
4. Người gửi bấm **Xem giá & đặt quà**: lấy giá/kho mới từ server, hiện tổng tiền. Chỉ bấm **Xác nhận đặt** mới tạo Order `AWAITING_PAYMENT / UNPAID`, giữ kho, đổi lời mời thành ORDERED. Món phải đúng cấu hình đã được bàn nhận đồng ý; giá/kho/quote không hợp lệ thì không tạo đơn và không đánh dấu ORDERED.
5. Nhân viên nhận tiền ở **bàn người gửi**, đủ tiền mới vào KDS. KDS ghi rõ **Bàn trả tiền** và **Quà → bàn nhận**, kèm lời nhắn. Quy trình CONFIRMED → PREPARING → READY → SERVED giữ nguyên; SERVED là đã giao quà tới bàn nhận.

PENDING/ACCEPTED quá hạn hoặc một trong hai phiên không còn OPEN sẽ EXPIRED, qua scheduler 30 giây và khi đọc/quyết định. Server luôn kiểm hạn khi tạo đơn, không phụ thuộc sweeper. ORDERED không bị hủy tự động khi hết 5 phút; xử lý như đơn thường. Lịch sử không dùng TTL để xóa.

## Tiền, kho, quyền và đóng/chuyển bàn

- `Order.tableSessionId/tableId/participantId` thuộc **người gửi**. `Order.gift` là đích giao riêng, gắn cả phiên và bàn nhận. Không tạo đơn thứ hai hoặc gán nợ cho bàn nhận.
- Kho giữ khi tạo đơn, trừ khi PREPARING, trả giữ khi hủy hợp lệ. Quà dùng cùng pricing, signed quote, inventory snapshot, Payment/CashShift, audit/outbox và WorkActivity của đơn tại bàn.
- Giao diện quà bản đầu không có ô nhập voucher/đổi điểm; API đặt đơn vẫn dùng chung chính sách ưu đãi hiện có. Nếu người gửi đã đăng nhập thành viên lúc đặt, điểm/ưu đãi thuộc thành viên đó; không nhận diện thành viên theo bàn nhận.
- Trước thu tiền: người gửi hủy qua **Đơn của tôi**, hoặc nhân viên hủy. Đã thu một phần/đủ tiền: nhân viên xác nhận hoàn thực tế trước pha chế theo quy tắc hiện có; không tự hoàn ngân hàng. Sau PREPARING không hỗ trợ hủy/hoàn trong luồng này.
- Bàn nhận chỉ có quyền quyết định lời mời và theo dõi giao món; không truy cập/hủy/đánh giá đơn của người gửi. Bản đầu giữ quyền đánh giá cho người gửi là chủ đơn sau PAID + SERVED; chưa có đánh giá quà riêng của người nhận.
- Hóa đơn và doanh thu chỉ tính một lần ở bàn người gửi. Bill snapshot/receipt/in và in lại giữ tên/mã bàn nhận từ lời mời; đổi tên/chuyển bàn sau này không sửa snapshot. Hóa đơn bàn nhận không cộng món quà.
- Không đóng phiên nhận khi còn Order quà chưa SERVED/CANCELLED; idle sweeper cũng bỏ qua phiên đó. Phiên người gửi theo chốt chặn đơn hiện có. CHECKOUT vẫn cho hoàn tất giao quà đã đặt, nhưng không tạo quà mới.
- Chặn chuyển cả bàn gửi/nhận khi có lời mời còn hạn hoặc đơn quà chưa kết thúc. Hủy lời mời hoặc phục vụ/hủy/hoàn đơn hợp lệ trước khi chuyển. Không tự chuyển đích giao của quà đang thực hiện.
- Tối đa 3 lời mời PENDING/ACCEPTED còn hạn/người gửi, 5 lời mời tới một phiên nhận; tối đa 5 lần gửi/10 phút/người gửi trong cùng phiên, kể cả lời mời đã hủy/từ chối. Mỗi lời mời tối đa 10 dòng × 10 phần. Trần 3 đơn chờ thanh toán của luồng tại bàn vẫn áp dụng.
- Các transaction cùng ghi phiên gửi/nhận và Gift; tranh nhận, đặt/đóng/chuyển bàn được tuần tự hóa. Unique owner/requestId và unique giftId trên Order ngăn gửi/đặt trùng. Pending request trong sessionStorage gắn phiên + participant; retry qua reload giữ nguyên payload và key, không tự POST khi mở trang.

## API

Tất cả đường dẫn dưới prefix `/api/v1`, yêu cầu cookie `mc_guest` còn hiệu lực. Mutation có CSRF guard/rate limiter; no-store. Guest/Internal pools và SPA route được tách như các chức năng hiện có.

| Method / path | Dữ liệu / kết quả |
| --- | --- |
| GET `/gifts/tables` | Phiên gửi phải OPEN. `{items:[{tableId,sessionId,name,code,available}]}` không QR/contact/participant |
| GET `/gifts?page=1` | 30 dòng/trang, `{items,total,page,incomingCount}`. Quà gửi chỉ chính participant; quà nhận của cả phiên bàn |
| POST `/gifts` | Strict `{requestId:UUID,recipientTableId,recipientSessionId,message,items}`. Retry cùng request/payload trả quà cũ |
| POST `/gifts/:id/decision` | Strict `{expectedVersion,decision:ACCEPT\|DECLINE\|CANCEL}`. Retry cùng actor/quyết định/version không tạo event lần hai |
| POST `/orders/quote` | Như đơn tại bàn, items đúng quà, chưa mutation |
| POST `/orders` | Bổ sung `giftId`; cùng `Idempotency-Key`, items, quoteToken, quyền/phiên và trạng thái ACCEPTED còn hạn |

Realtime `gift.changed` qua outbox chỉ gửi `{refresh:true}` tới guest chính người gửi và room phiên nhận, không broadcast sang các bàn khác/Staff. Client đọc lại theo quyền, reconnect refetch, polling 10 giây dự phòng; lời mời mới có badge/thông báo nổi và banner mở trang quà. Staff dùng event đơn hiện có khi quà được đặt/thu/chuyển trạng thái.

Migration `20261022-001-gift-indexes` tạo collection/index replay/history/expiry cho Gift và unique/lookup delivery trên Order. Chỉ thêm index, không backfill hoặc thay bản ghi nghiệp vụ cũ. Không chạy seed/reset.

## 14 kịch bản tự kiểm tra

Chuẩn bị hai trình duyệt/thiết bị độc lập quét QR hai bàn A/B đang OPEN; Staff đăng nhập trên 8081. Dùng DB demo riêng nếu muốn thử giao dịch; không reset dữ liệu quán.

1. **Chưa QR**: mở `/gifts` → yêu cầu vào bàn; tài khoản thành viên một mình không được gửi quà.
2. **Chọn bàn**: A không thấy chính bàn A; bàn trống/không có khách hợp lệ bị vô hiệu hóa. B đổi phiên sau khi A chọn → nút gửi khóa cho tới khi chọn lại; API cũng từ chối phiên cũ.
3. **Giỏ độc lập**: thêm một món vào giỏ bàn, rồi chọn/tùy chỉnh món quà → giỏ bàn và mang đi giữ nguyên. Chưa bấm gửi không tạo Gift/Order/giữ kho.
4. **Ẩn danh/thông báo**: A gửi B cùng lời nhắn → B có badge/banner/thông báo, thấy món/tùy chọn/lời nhắn, không thấy bàn A/định danh/mã đơn/giá. Bàn C không nhận event hoặc xem quà này.
5. **Từ chối/hủy**: B từ chối hoặc A hủy → không Order/kho/thu tiền. Người khác ở bàn A không được hủy lời mời của participant A.
6. **Tranh nhận**: hai thiết bị ở B cùng Nhận/Từ chối → đúng một quyết định; thiết bị thua tải lại. Reload/thử lại quyết định đã thành công không nhân đôi event.
7. **Hết hạn**: chờ 5 phút không nhận → EXPIRED; nhận xong chờ thêm 5 phút không đặt → EXPIRED. Không phát sinh nợ/giữ kho.
8. **Nhận rồi xác nhận giá**: B nhận → A có Xem giá & đặt quà; chỉ xem giá chưa có Order. A xác nhận tổng mới → đúng một đơn ở A, chưa vào KDS, giữ kho một lần; B không có món này trong Đơn của tôi.
9. **Giá/tồn thay đổi**: sau B nhận, Admin đổi giá/hết nguyên liệu → quote/đặt kiểm tra mới; lỗi giữ trạng thái chưa đặt, không giữ kho hay tạo đơn một phần. Món/cấu hình khác lời mời bị từ chối.
10. **Mất mạng/reload**: mất phản hồi khi gửi hoặc đặt → khóa sửa, hiện Thử lại yêu cầu; reload/thử lại giữ đúng payload/key và chỉ một Gift/Order/giữ kho. Đổi participant không gửi lại pending của người trước.
11. **Thu/giao**: Staff nhận tiền từ A, thu thiếu chưa vào KDS; thu đủ mới xuất hiện, rõ bàn trả tiền A/đích B/lời nhắn. Qua 4 công đoạn → B thấy Đã giao quà; kho trừ một lần lúc PREPARING.
12. **Hoàn/hủy**: A hủy chưa thu → trả giữ; thu một phần/đủ → hủy trực tiếp bị chặn, Staff xác nhận hoàn trước pha thì hủy/trả giữ. Sau pha không được hoàn theo luồng này.
13. **Đóng/chuyển bàn**: lời mời còn hạn chặn chuyển, đóng trước tạo đơn làm lời mời mất hiệu lực; đơn đã đặt chặn đóng/idle-close bàn B và chuyển A/B. Phục vụ/hủy hợp lệ rồi mới đóng/chuyển; phiên mới của B không thấy quà phiên cũ.
14. **Hóa đơn/quyền/giới hạn**: A trả đủ + giao xong → Bill/receipt/in lại A có món quà/đích B, B không bị tính tiền. Chỉ A đánh giá được; điểm thuộc thành viên A lúc đặt. Thử trần 3/5 và gửi liên tiếp đã hủy → server chặn. Hơn 30 lịch sử dùng phân trang đúng quyền.

Kiểm tự động bằng Lightpanda chứng minh DOM/hành vi. Chưa có bằng chứng trực quan cho bố cục, che khuất, kích thước hiển thị trên điện thoại hoặc máy in thật.
