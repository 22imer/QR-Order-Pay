# QR động và thanh toán trước từng đơn

## Cách dùng

1. Đăng nhập Staff, mở **Bàn & phiên** (`/staff/tables`). Admin cũng có thể cấu hình tại trang quản lý bàn.
2. Bấm **Cấu hình màn hình QR** của bàn, cấp liên kết, rồi mở liên kết đó trên tablet/màn hình của chính bàn. Giữ trang này mở và có mạng.
3. Khách quét **QR hiển thị trên màn hình** bằng Wi-Fi hoặc 4G. Mã đổi theo chu kỳ 60 giây; bộ đếm cho biết thời gian còn lại. Lần mở màn hình đầu tiên có thể còn ít hơn 60 giây vì chu kỳ tính theo phút của server.
   Khi dùng trên cùng máy, bấm **Mở link vào bàn** bên dưới QR để mở trang gọi món ở tab mới; **Sao chép link** lấy đúng link khách còn hạn. Link hiển thị cũng tự đổi cùng QR và được ẩn khi hết hạn/mất mạng.
4. Khách gửi đơn. Đơn mang trạng thái **Chờ thanh toán**, chưa xuất hiện trên KDS.
5. Nhân viên mở mục **Chờ thanh toán**, bấm **Kiểm tra & nhận tiền** để giữ quyền thu cho bàn, chọn phương thức và nhập số tiền thực nhận. Thu một phần thì ghi nhận khoản thu, đơn vẫn chờ; thu đủ thì **Đã nhận đủ tiền — chuyển KDS**. Xem [xử lý thiếu tiền, thu nhầm và điều chỉnh](payment-safeguards.md).
6. KDS xử lý đơn đã trả tiền như trước. Khách tiếp tục gọi thêm mà không cần quét lại; mỗi đơn mới phải thanh toán riêng.
   Đơn **đã phục vụ và đã thanh toán** hiện nút **Đánh giá đơn** trên trang **Đơn của bạn**, không cần chờ đóng phiên. Mỗi đơn đánh giá một lần; gọi thêm đơn mới thì đánh giá riêng đơn đó khi đủ điều kiện. Đánh giá đã gửi vẫn hiển thị sau khi tải lại trang và trên hóa đơn cuối phiên.
7. Khi khách rời bàn, phục vụ/hủy hết đơn, xử lý các yêu cầu hủy rồi bấm **Đóng phiên không còn nợ**. Server chốt hóa đơn toàn bàn, thu hồi phiên khách và QR còn hạn của lượt cũ. Hóa đơn có thể in ngay; khách còn quyền xem hóa đơn và đánh giá.

Liên kết `/display#…` là khóa cấu hình riêng của thiết bị tại bàn, **không đưa cho khách và không in thành QR**. Chỉ QR bên trong trang mới dành cho khách. Cấp lại liên kết sẽ vô hiệu liên kết màn hình cũ và các QR cũ ngay; khách đã vào phiên vẫn giữ quyền gọi món đến khi đóng phiên.

## Quy tắc phía server

- QR là vé HMAC có thời hạn, gắn với bàn và `qrEpoch`; server kiểm tra chữ ký, hạn và thế hệ vé. Token QR tĩnh trước đây không còn được nhận để vào bàn.
- Khóa màn hình được lưu dưới dạng hash, gửi bằng header `X-Table-Display-Token`, không xuất hiện trong URL yêu cầu API. API QR trả `Cache-Control: no-store`; màn hình ẩn QR hết hạn khi mất mạng.
- Cấp quyền vào bàn, đóng phiên và vô hiệu QR dùng transaction để tránh cấp nhầm quyền sang lượt khách tiếp theo.
- Đơn mới: `AWAITING_PAYMENT / UNPAID` → nhân viên xác nhận đủ tiền → `PENDING / PAID` → `CONFIRMED` → `PREPARING` → `READY` → `SERVED`.
- KDS chỉ trả đơn `PAID`; API chuyển công đoạn cũng chặn đơn chưa thanh toán. Giá và số tiền được kiểm tra trên server.
- Xác nhận khoản thu có idempotency key: gửi lại cùng yêu cầu không tạo khoản thu thứ hai. Khoản thu làm tăng phiên bản phiên nhưng không đóng phiên hoặc ngắt socket khách.
- Mỗi thiết bị có tối đa 3 đơn đang chờ thanh toán trong một phiên, cùng các rate limit hiện có. Hủy đơn chưa trả tiền giải phóng giới hạn.
- Đóng phiên chỉ được thực hiện khi mọi đơn đã phục vụ hoặc hủy, không còn nợ và không còn yêu cầu hủy chờ xử lý. Hóa đơn snapshot được tạo trong cùng transaction.
- Đánh giá không đóng phiên, thu hồi quyền gọi món hoặc sửa hóa đơn. API kiểm tra đơn thuộc đúng thiết bị/phiên và trạng thái `SERVED / PAID`; unique index theo đơn ngăn đánh giá trùng, kể cả gửi đồng thời. Trang hóa đơn sau đóng phiên chỉ cho gửi những đánh giá còn thiếu.
- Đơn đã thu tiền và chưa pha chế chỉ được hủy kèm xác nhận đã hoàn đủ tiền. Giao diện KDS ghi nhận hoàn **tiền mặt** thực tế; API hỗ trợ phương thức khác. Đây là ghi nhận hoàn thủ công, không tự chuyển tiền qua ngân hàng. Đối soát ca tính cả tiền đã thu và tiền đã hoàn.
- Đường thanh toán gộp cuối phiên được giữ để xử lý dữ liệu cũ đã phục vụ nhưng chưa trả tiền; đơn mới dùng luồng thu từng đơn.

## Triển khai

- Build lại contracts, API, workers và client cùng phiên bản. Không cần reset/seed lại dữ liệu đang sử dụng.
- Sau nâng cấp, cấp liên kết màn hình cho từng bàn; QR tĩnh đã in không còn dùng để vào bàn.
- Các API instance phải dùng cùng `JWT_ACCESS_SECRET` và đồng hồ đồng bộ. Chu kỳ QR cố định 60 giây.
- `PUBLIC_APP_URL` phải là địa chỉ portal khách mà điện thoại truy cập được. Dùng 4G cần domain/public URL và HTTPS phù hợp; `localhost` hoặc IP LAN không truy cập được từ 4G. Cấu hình các origin và reverse proxy tương ứng.
- Staff/Admin tiếp tục dùng portal nội bộ. Tablet hiển thị QR dùng portal khách nên không cần đăng nhập tài khoản Staff trên thiết bị đó.
- Seed demo mới in liên kết cấu hình màn hình, không in vé QR cho khách. Seed chỉ dùng khi chủ động muốn reset dữ liệu demo.
- Playwright dùng `E2E_DISPLAY_TOKEN` để xin vé mới cho từng test. Load test dùng khóa riêng của database benchmark (`BENCHMARK_DISPLAY_TOKEN` khi seed, `TABLE_DISPLAY_TOKEN` khi chạy k6).

## Phạm vi bảo vệ

QR động giảm thời gian ảnh chụp/link cũ được dùng để tham gia bàn. Thanh toán trước ngăn đơn rác chưa trả tiền vào quầy pha chế. Hệ thống không xác minh khách còn ở trong quán: người đã vào phiên vẫn có thể gửi đơn chờ thanh toán hoặc yêu cầu phục vụ từ xa cho đến khi nhân viên đóng phiên. Ảnh QR còn hạn cũng có thể bị chia sẻ. Vì vậy thao tác đóng phiên khi khách rời bàn vẫn cần được thực hiện, và nhân viên chỉ xác nhận khoản thu thực tế.
