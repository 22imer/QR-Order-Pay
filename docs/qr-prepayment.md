# QR tĩnh và thanh toán trước

Cập nhật 26/10/2026 theo yêu cầu người dùng, thay thế luồng QR đổi mỗi 60 giây.

## Dùng QR tại bàn

1. Staff mở **Bàn & phiên** hoặc Admin mở **Bàn & QR tĩnh**, chọn **Xem QR tĩnh**.
2. Bấm **Tải ảnh QR** để in đặt tại bàn, hoặc **Mở link vào bàn / Sao chép link** để thử trên cùng máy. Xem/tải QR không xoay khóa, không mở phiên và không ghi dữ liệu bàn.
3. Khách quét mã cố định để vào phiên hiện tại. Nếu bàn trống và không vướng lịch đặt, server tự mở phiên theo cấu hình hiện có.
4. Nhiều thiết bị cùng quét một QR sẽ tham gia cùng phiên, mỗi thiết bị có participant riêng. Quét lại trong cùng phiên giữ quyền xem đơn của thiết bị đó.
5. Đóng phiên thu hồi quyền khách cũ nhưng QR in vẫn giữ nguyên; lần quét sau mở phiên mới. Các chốt đặt bàn #10 vẫn áp dụng, không tự mở bàn có lịch giữ chỗ trong 60 phút tới.

QR mới là token HMAC `qrs1` gắn tableId và staticQrEpoch, không có thời hạn theo đồng hồ. Thế hệ QR tĩnh riêng với qrEpoch cũ: đóng/chuyển phiên không đổi QR in. Endpoint cấp lại khóa màn hình cũ vẫn là thao tác xoay rõ ràng, sẽ thu hồi QR tĩnh cũ của bàn. Bàn ngừng hoạt động từ chối vào. Không backfill/reset hoặc tự xoay khóa các bàn hiện có. Vé động còn hạn được hỗ trợ để tương thích, nhưng mã được cấp mới luôn cố định. Token ngẫu nhiên legacy chỉ lưu hash không tự khôi phục; lấy QR mới từ Staff/Admin.

`GET /api/v1/staff/tables/:id/qr` (STAFF/ADMIN) và `GET /api/v1/admin/tables/:id/qr` (ADMIN) trả `{tableId,tableName,url}`, no-store, không trả khóa màn hình. Trang `/display#…` cũ tiếp tục hiển thị cùng QR cố định, có tải PNG; API display trả `expiresAt:null`.

## Thành viên

Vào phiên bàn mới hoặc rời bàn thu hồi đăng nhập thành viên trên trình duyệt đó, xóa cookie. Quét lại cùng phiên không tự đăng xuất nếu khách vừa chủ động đăng nhập. Cookie thành viên mới là cookie phiên trình duyệt, không còn Max-Age 14 ngày; hạn tối đa phía DB vẫn giữ 14 ngày. Không sửa tài khoản/điểm/đơn cũ hoặc thu hồi toàn bộ phiên của người khác.

## Thanh toán giữ nguyên

`AWAITING_PAYMENT / UNPAID` → Staff nhận tiền từng phần/đủ → `PENDING / PAID` mới vào KDS → `CONFIRMED / PREPARING / READY / SERVED`. Đơn giữ nguyên liệu khi đặt, trừ khi pha, trả giữ khi hủy hợp lệ. Đã thu phải hoàn thực tế trước pha mới hủy, không tự chuyển tiền ngân hàng.

Đóng phiên yêu cầu hết nợ, mọi đơn phục vụ/hủy và hết yêu cầu hủy chờ. Bill snapshot bất biến toàn bàn; Staff in, khách chỉ xem đơn của thiết bị và đánh giá. Quote/idempotency, quyền thu tiền và các guard cũ giữ nguyên; xem [payment-safeguards.md](payment-safeguards.md).

## Tự test

1. Xem QR hai lần: cùng link/ảnh, không tạo phiên. Tải PNG để in.
2. Chờ hơn một phút, tải lại QR: mã không đổi. Hai thiết bị quét cùng bàn: cùng phiên, khác participant.
3. Đóng phiên rỗng hoặc đã xử lý hết đơn, quét lại QR đã in: phiên mới, cookie khách cũ không đặt được.
4. Đăng nhập thành viên rồi rời bàn/vào phiên mới: yêu cầu đăng nhập lại. Đăng nhập trong phiên rồi tải lại/quét lại cùng phiên: vẫn đăng nhập.
5. Bàn ngừng dùng/QR sửa chữ ký: không vào được. Bàn sắp có lịch #10: không tự mở trái lịch.
6. Thu thiếu/đủ, KDS, gọi thêm và đóng/in hóa đơn như luồng cũ.

PUBLIC_APP_URL phải truy cập được từ thiết bị quét; localhost chỉ dùng trên chính máy tính. QR in dùng lại được nên cần đóng phiên khi nhóm rời quán; link cố định không xác minh hiện diện. Camera/điện thoại và bản in thực cần kiểm thiết bị thật.
