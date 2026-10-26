# Ảnh in tem dán cốc (#9)

User chốt ngày 23/10/2026: **in ảnh thành tem dán cốc**, có xem trước và trang in. #7 Telegram để lại sau.

## Dùng thử

1. Khách QR chọn món, vào **Giỏ hàng**, chọn **Ảnh in tem** ở từng dòng món. Mang đi/đặt trước và quà gửi bàn khác cũng có lựa chọn này. Tạo đơn không ảnh vẫn như cũ; ảnh không thay giá.
2. Chỉ nhận JPEG/PNG/WebP tĩnh, tối đa **4 MB**, mỗi chiều ít nhất64px, tối đa16triệu điểm ảnh. Khuyên dùng ảnh ít nhất600px để in rõ. Ảnh cùng dòng dùng chung cho mọi cốc; muốn mỗi cốc một ảnh thì thêm thành các dòng riêng.
3. Xem ảnh chuẩn hóa trước khi đặt. Giữ trọn ảnh, không tự cắt; xoay theo EXIF, nền trong suốt thành trắng. Có Bỏ ảnh và Thử lại tải ảnh khi mất mạng. Không thể gửi đơn khi ảnh đang tải.
4. Đặt/nhận quà/xác nhận giá/thanh toán như bình thường. Người nhận quà chỉ thấy “Có ảnh in tem”; không thấy ID ảnh hoặc ảnh gốc trước khi nhận. KDS có liên kết **Có ảnh · Mở in tem**.
5. Staff/Admin mở **In tem ảnh** (`/staff/cup-prints`, `/admin/cup-prints`). Chỉ đơn đã thanh toán, không hủy/hoàn, mới có trong danh sách. Chọn **Xem & in tem**, đối chiếu mã đơn, dòng món, tên/size và số cốc.
6. Tem **60×80mm**, ảnh50×50mm giữ tỷ lệ. Chọn A4 để cắt tem hoặc giấy tem60×80mm. Số tem từ1 đến số cốc trong dòng, tối đa50; bản in đánh số từ1. In lại một phần cần kiểm tra các số cốc trùng.
7. Bấm **In tem**, chọn máy/khổ giấy, **100% / kích thước thật**, tắt header/footer trong hộp thoại. App không tự tìm/cài driver, không in trực tiếp lên cà phê/cốc và không điều khiển máy in mạng/USB.

## Lưu trữ và quyền

- Server dùng sharp/libvips giải mã thật sau kiểm MIME/magic bytes, chặn SVG/GIF/PDF/ảnh động, ảnh hỏng và ảnh quá lớn. Chuẩn hóa JPEG quality85, cạnh tối đa1024px, không phóng ảnh nhỏ; bỏ EXIF/ICC và không lưu tên file gốc. Buffer chuẩn hóa tối đa1MB, lưu riêng trong MongoDB, không trả trong danh sách đơn.
- Ảnh chưa gắn đơn/quà hết hạn sau24giờ. Khi gắn vào đơn/quà, giữ ít nhất30ngày từ lần gắn; MongoDB TTL xóa sau hạn và API chặn ngay khi hết hạn, không phụ thuộc chu kỳ TTL. Bỏ ảnh trong giỏ chỉ bỏ liên kết, ảnh rời tự hết hạn. Không lưu file trên ổ/container hoặc public bucket, nên nhiều API dùng chung MongoDB và restart không làm mất ảnh.
- Cookie QR đúng participant/phiên, member đúng tài khoản hoặc counter đúng user mới xem ảnh riêng đã tải. Staff/Admin chỉ lấy ảnh người khác qua đơn đã thanh toán, còn hiệu lực. Guest/order DTO chỉ có `hasCupPhoto`, không có private asset ID/URL; người gửi quà nhận ID để tạo đúng đơn, phía nhận chỉ có cờ. API ảnh `no-store`, JPEG + nosniff, Blob URL preview được thu hồi khi đóng/rời.
- Upload raw bytes, UUID header `Idempotency-Key`, CSRF Guest/member, 5 upload/phút/bàn (hoặc IP nếu không có bàn), quota20ảnh/24giờ/chủ thể và tối đa2 tác vụ giải mã cùng lúc/API. Giới hạn proxy API4MB; JSON app vẫn256KB. Không xử lý URL ảnh bên ngoài. UUID/hash/transaction chống upload trùng và key đổi nội dung; retry trong trang giữ đúng file/key, reload khi upload chưa rõ kết quả cần chọn lại file (ảnh rời tự hết hạn).
- Quote/hash bao gồm ID ảnh. Gắn ảnh transaction kiểm quyền/hạn và giữ tuổi thọ, rollback cùng tạo đơn/giữ kho/ưu đãi. Đổi ảnh sau báo giá phải báo lại; không dùng ảnh của người/bàn/member/counter khác. Quà giữ ảnh đã chọn cùng nội dung lời mời, không đổi ảnh khi người gửi tạo đơn.
- Mỗi lệnh in ghi `CupPrintAttempt` unique user/request cùng audit, kiểm đơn và số cốc, replay không đếm thêm lần. Reprint chủ động dùng key mới. Nhật ký chỉ là **REQUESTED / yêu cầu in**, không phải bằng chứng máy đã in, đã dán, hay khách đã nhận. Hủy hộp thoại vẫn có thể có một yêu cầu đã ghi. Ctrl+P/manual print nằm ngoài nhật ký nút In tem.
- Print lấy ảnh riêng qua JWT thành Blob URL, không nhét token vào URL. Dữ liệu khách/đơn không gửi sang dịch vụ ảnh hoặc máy in ngoài qua API. Không sửa tổng tiền, Payment, Bill, trạng thái phục vụ hay hoàn tiền khi in; version Order có thể tăng để khóa đua với hủy/hoàn.
- Migration `20261023-001-cup-photo-indexes`: photo replay/quota/TTL, owner TTL, print request unique và Order print-queue partial index; không sửa ảnh/món/giá/đơn cũ. `sharp` theo [constructor](https://sharp.pixelplumbing.com/api-constructor/), [metadata](https://sharp.pixelplumbing.com/api-input/) và [output](https://sharp.pixelplumbing.com/api-output/).

## Kịch bản tự kiểm tra

1. Chưa QR/chưa member/chưa đăng nhập nội bộ: upload và đọc ảnh bị chặn; Staff không vào API Admin được; các portal đúng quyền.
2. JPEG/PNG/WebP hợp lệ lên được và xem đúng ảnh, ảnh xoay EXIF nằm đúng hướng, trong suốt thành trắng; ảnh gốc/tên file/EXIF không được trả.
3. SVG/GIF/PDF, MIME giả, file hỏng, >4MB, >16MP, ảnh nhỏ<64px và WebP động bị từ chối; có thông báo, không tạo Order/Payment.
4. Tải ảnh rồi ngắt mạng: Thử lại cùng key không tạo ảnh trùng; key đổi bytes conflict; rời trang khi upload không gắn nhầm ảnh vào giỏ khác.
5. Hai thiết bị/participant cùng bàn, member khác và nhân viên khác không đọc/gắn ảnh riêng của nhau; Staff xem qua đơn đã thu tiền được.
6. Bỏ/đổi ảnh trong giỏ, ảnh cũ hết hạn, thay ảnh sau quote: báo lại/đòi chọn lại, không tạo đơn nhầm; không ảnh vẫn đặt bình thường.
7. Dòng2cốc cùng ảnh, hai dòng khác ảnh: lưu đúng ID từng dòng và xem/in đúng mã/dòng/cốc. Tổng tiền/kho/ưu đãi giữ đúng luồng cũ.
8. Mang đi và pre-order từ member/counter: ảnh đúng chủ, reload pending create vẫn đúng ảnh/key; thanh toán trước khi in.
9. Quà có ảnh: người nhận chỉ thấy cờ, accept rồi sender tạo/trả đơn đúng ảnh; anonymous/show-table giữ quy tắc cũ, tem giao đúng bàn nhận.
10. Chưa trả tiền/hủy/hoàn không được xem/in; ảnh hết hạn có trạng thái không khả dụng; không lộ bytes từ API danh sách.
11. Preview đủ mã/tên/size/số cốc, số tem không vượt dòng, đổi khổ A4/60×80. Ảnh lỗi/chưa giải mã xong không cho bấm in.
12. Double click/mất phản hồi print: retry đúng request, nhật ký một lần; reprint chủ động lần mới. API từ chối sau khi đơn bị hủy, không coi REQUESTED là đã in.
13. In A4 và tem thật: kiểm tra 60×80mm, ảnh50×50, không tràn/cắt, đúng số tem/trang/scale100%, màu/chất lượng/độ bám. Thử hủy hộp thoại và driver/máy mục tiêu.
14. Đóng preview/rời/logout: Blob URL và print CSS được dọn, in hóa đơn cũ không bị đổi; restart API vẫn đọc ảnh từ DB; TTL/hạn30ngày hoạt động.

Lightpanda chỉ chứng minh DOM/hành vi/API; không chứng minh bản xem trước trực quan, hộp thoại hệ điều hành, máy in, số đo/độ sắc nét/màu tem hay giấy đã in thật. Ca13 cần máy/giấy thực tế.
