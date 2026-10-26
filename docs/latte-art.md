# Tự thiết kế latte art từ ảnh

Cập nhật 26/10/2026. User chọn in trực tiếp lên lớp bọt như ảnh tham khảo, hiện chưa có máy in thực phẩm. Phần mềm tạo/chọn/lưu thiết kế và xuất file; chưa gửi lệnh tới phần cứng hoặc xác nhận đã in lên bọt.

## Trải nghiệm khách

1. Chọn món, mở giỏ, tại **Ảnh trên cốc** chọn **Latte art trên bọt**. Luồng tại bàn, member mang đi/counter và quà đều hỗ trợ; ảnh tem #9 vẫn là lựa chọn riêng.
2. Tải JPEG/PNG/WebP tĩnh <=4MB, mỗi chiều >=64px, <=16MP. Dùng ảnh rõ, chủ thể lớn, sáng đều. Không nhận SVG/GIF/PDF/ảnh động hoặc URL ngoài.
3. Hệ thống tạo đúng ba bản **Latte mềm / Cacao đậm / Chấm nghệ thuật** từ chính pixel ảnh gốc. Đổi sắc độ sang tông cà phê, không gọi AI, không vẽ lại mặt/nội dung, không gửi ảnh tới bên thứ ba. Giữ tỷ lệ/toàn bộ ảnh; ảnh được thu vào vùng an toàn của mặt cốc tròn.
4. Màn hình ghép ảnh trên nền bọt mô phỏng. Khách bấm chọn một bản mới gắn ID đó vào dòng món. Không tự gắn ảnh gốc hoặc chọn hộ. Trong lúc tạo/chờ chọn, checkout bị khóa; có Hủy/Bỏ ảnh để tiếp tục. Hai dòng cùng xử lý không được mở khóa nhầm nhau.
5. Chọn xong vẫn có thể thay ảnh/bỏ ảnh trước khi đặt. Cùng dòng nhiều cốc dùng chung một thiết kế; muốn mỗi cốc một ảnh, tách dòng. Ảnh không thêm giá. Quote/đặt/kho/ưu đãi/thu tiền giữ luồng hiện có.
6. Tải lại giỏ giữ đúng bản đã chọn. Khi chưa chọn mà reload, cần chọn file lại; file gốc không lưu trong localStorage/sessionStorage. Retry trong trang giữ đúng upload key/source, generation idempotent theo nguồn + công thức v1 nên không tạo bộ ba trùng.

## Nhân viên và file cho máy in tương lai

Staff/Admin → **Ảnh cốc & latte art**, chỉ đơn đã thu đủ tiền và còn hiệu lực. Dòng latte art có **Xem & xuất latte art**; đối chiếu mã đơn, món/size, đích giao và số cốc, bấm **Tải PNG cho máy in đồ uống**.

File PNG **1024×1024**, RGB nền trắng, cùng pixel thiết kế khách đã chọn; không có chữ, mã đơn, khung cốc hoặc giả lập bọt trong file. Nền trắng biểu thị vùng không in. Không mặc định đường kính/DPI/crop/mirror hoặc profile mực cho một model chưa có. Khi có máy, cần nhập file vào phần mềm máy, cấu hình vùng in/đường kính, căn tâm và kiểm tra trên bọt thực tế.

Không mở hộp thoại in tem A4/60×80 cho latte art, không coi nút xuất PNG là đã in/đã giao. Nhật ký `latteArt.exportRequested`/CupPrintAttempt paper=LATTE_PNG chỉ ghi yêu cầu chuẩn bị file, retry UUID/hash không đếm lần thứ hai. Xuất chủ động lần mới có key mới. Hủy/hoàn/hết hạn sẽ chặn cả retry cũ. Xuất file không tạo Payment/Bill, không đổi tiền/trạng thái phục vụ; Order.version chỉ tăng để tuần tự hóa với hủy/hoàn.

## Lưu trữ và API

Dùng CupPhoto sẵn có, thêm kind PHOTO/LATTE_ART, latteStyle SOFT/BOLD/DOTS, sourcePhotoId. Document cũ tiếp tục là ảnh tem; không migration/index/backfill/reset. Ba ảnh dẫn xuất có requestId nội bộ xác định từ source/version/style, dùng unique owner+requestId hiện có. Generation khóa owner/phiên, recheck hạn và lưu cả ba cùng audit trong transaction. Lỗi rollback toàn bộ. Giới hạn render2/API, đầu vào đã normalize tối đa1024, đầu raJPEG<=1MB/ảnh; ảnh gốc tính quota20/24h, ba biến thể không bị tính như ba upload mới. Upload và generate cùng limiter5/phút theo bàn hoặc IP.

Ảnh gốc/bản chưa gắn hết hạn24h; bản đã chọn gắn đơn/quà được gia hạn ít nhất30ngày như #9. Hết hạn gốc không làm mất bản đã gắn. GET blob/details đúng owner; guest khác cùng bàn cũng không xem được. Staff export chỉ qua đơn PAID, không có URL public, token trong URL hoặc bytes trong DTO danh sách.

Prefix `/api/v1`, generation strict `{}`:

- GET `/{cup-photos|pickup/cup-photos|staff/cup-photos|admin/cup-photos}/:id/details`: metadata riêng của chủ, có kind/latteStyle khi latte art.
- POST cùng prefix `/:id/latte-art`: sourceId chính chủ chưa hết hạn, trả sourceId và đúng3 CupPhotoView; không nhận style/món/owner tự khai. Không generate lặp từ ảnh đã chuyển. Guest yêu cầu OPEN + CSRF, member/counter đúng chủ và portal/role như upload.
- POST `/{staff|admin}/cup-prints/latte-art/exports`: strict `{requestId UUID,orderId24hex,itemIndex>=0}`, trả attachment PNG/no-store; kiểm đúng dòng, PAID/còn hạn/kind LATTE_ART, audit/replay. Endpoint in tem cũ không nhận ảnh LATTE_ART.

## 14 ca tự test

1. Khách QR vào giỏ chọn Latte art trên bọt; chưa QR/member/internal auth thì không upload/generate được.
2. Tải ảnh chân dung/phong cảnh/chữ đơn giản: đủ3 bản khác nhau, giữ bố cục, đúng hướng và tỷ lệ.
3. Nhìn mặt/chữ/nét đặc trưng còn đúng ảnh gốc; nền bọt chỉ là preview, không phải nội dung PNG xuất.
4. Chưa chọn thì chưa gắn ảnh, nút đặt khóa; chọn rõ một bản mới mở khóa. Hủy tạo/Bỏ ảnh mở khóa mà không gắn ảnh gốc.
5. Đổi file hoặc tải lỗi/retry không lẫn ảnh cũ. Hai dòng cùng xử lý: hoàn tất dòng1 vẫn khóa đặt nếu dòng2 chưa chọn.
6. Đổi tài khoản/rời/unmount lúc xử lý không gắn response muộn vào giỏ người mới. URL blob được dọn.
7. Reload sau chọn: giữ đúng bản; thay style sau quote phải báo giá lại. ID ảnh thuộc người khác/hết hạn bị chặn khi quote/place.
8. SVG/GIF/PDF/ảnh động/MIME giả/filehỏng/>4MB/>16MP/<64px bị từ chối trước chuyển đổi.
9. Gửi generation nhiều lần/song song cùng nguồn: vẫn đúng3 biến thể, không Order/Payment/giữ kho; source không đổi.
10. Đặt2cốc cùng bản, kiểm tổng tiền/giữ kho; trước thu không có export, thu đủ mới xuất đúng bản/dòng/số cốc.
11. Staff xem latte art → xuấtPNG: 1024×1024, nền trắng, không chữ/mã/foam; không mở in tem, không ghi đã in.
12. Mất phản hồi export → retry đúng request/key, một journal; đã hủy/hoàn/hết hạn thì retry bị chặn.
13. Member pickup/counter/quà giữ đúng ảnh và quyền; bàn nhận quà chỉ có cờ ảnh, không thấy nguồn riêng của sender.
14. Đóng preview/rời rồi in tem/hóa đơn: CSS/Blob không lẫn. Khi mua máy, kiểm căn tâm, vùng in, độ tương phản/màu/mực thực phẩm/độ bền trên loại bọt của quán trước nghiệm thu in thực tế.

Lightpanda chỉ xác minh DOM/hành vi/luồng dữ liệu. Ảnh đầu ra có thể kiểm độc lập bằng decoder/render; chưa phải bằng chứng bố cục trên điện thoại, cảm nhận thẩm mỹ trên cốc hay chất lượng in thực. Chưa có máy nên phần in trực tiếp lên bọt chưa nghiệm thu.
