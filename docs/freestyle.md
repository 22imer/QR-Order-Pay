# AI Barista Freestyle (#8)

Khách mở **AI Barista → Freestyle** tại bàn QR hoặc trang mang đi sau khi đăng nhập thành viên. Chọn ngân sách, yêu cầu không caffeine/không sữa và mô tả khẩu vị. Gợi ý là món riêng ngoài thực đơn, phối một nền với một hoặc hai vị đã được quán duyệt. Mỗi cốc có cùng giá và size do Admin cấu hình; không thêm topping hay đổi đường/đá ngoài công thức.

## Thiết lập trước khi bán

1. Vào **Admin → AI Freestyle** (`/admin/freestyle`). Mặc định tắt, giá 0; việc đọc không tạo cấu hình hay dữ liệu mẫu.
2. Nhập giá cố định từ 1.000đ đến 1.000.000đ, tên size và dung tích 250–700 ml.
3. Thêm vị rồi nền: tên, nguyên liệu từ kho, đơn vị và lượng mỗi cốc, hướng dẫn pha, từ khóa khẩu vị. Khai rõ caffeine/sữa: có, không hoặc chưa xác nhận. Chưa xác nhận không đáp ứng yêu cầu “không”.
4. Chọn vị được phép đi cùng từng nền, tối đa 1 hoặc 2 vị; chọn các cặp vị không pha chung. Quy tắc xung khắc áp dụng hai chiều. Tối đa 6 nền/12 vị, mỗi phần tối đa 8 nguyên liệu. Mỗi thành phần tối đa 200 g/500 ml/5 phần, tổng công thức tối đa 250 g/5 phần và tổng ml không vượt dung tích.
5. Quán thử pha và duyệt định lượng/hướng dẫn thực tế, rồi bật và lưu. Hạn mức phần mềm không chứng nhận hương vị, dinh dưỡng hay dị ứng. Đường/đá cũng cần có trong thành phần/hướng dẫn đã duyệt.

Mất kết nối khi lưu: trang khóa chỉnh sửa, giữ yêu cầu trong sessionStorage theo Admin và cho thử lại đúng UUID/nội dung. Cấu hình có version; khi báo thay đổi, tải lại bản đã lưu trước khi sửa. Không tự ghi đè bản người khác. Không seed nguyên liệu hay bật bán trên dữ liệu quán.

## Cách hệ thống xử lý

- Server tạo danh sách công thức hợp lệ từ nền/vị, đơn vị nguyên liệu đang dùng, giới hạn lượng, khả năng phối và tồn khả dụng. Kiểm tổng lượng nếu nhiều phần dùng chung nguyên liệu. Giá được lấy ở server, ưu đãi/điểm áp dụng như món thường.
- `AI_MODE=live`: model chỉ chọn tối đa 3 ID ứng viên từ server; tên, giá, nguyên liệu, lượng và hướng dẫn luôn do server cung cấp. ID lạ, trường thừa, JSON sai hoặc lỗi provider chuyển sang gợi ý theo quy tắc. `fallback` không gọi provider; `off` không đưa đề xuất. Chỉ gửi khẩu vị và dữ liệu công thức, không gửi token/danh tính khách/ID kho.
- Ràng buộc không caffeine/không sữa và ngân sách được kiểm tại server; yêu cầu “không cà phê” lọc cà phê riêng. Khẩu vị khác dùng để xếp hạng, không phải cam kết dinh dưỡng. Công thức có sữa/caffeine/chưa xác nhận không được gọi là không sữa/caffeine.
- Đề xuất ký HMAC, hết hạn 30 phút, gắn đúng participant của phiên QR hoặc tài khoản thành viên. Thêm vào giỏ gọi kiểm lại; báo giá và tạo đơn kiểm tiếp chủ sở hữu, hạn, cấu hình, nguyên liệu và kho. Đổi cấu hình làm đề xuất cũ hết hiệu lực. Đổi lượng đặt kiểm lại tồn tổng cả món thường và Freestyle; giao dịch giữ kho chặn bán quá tồn.
- Không tạo Product/Recipe/Category tự động. Dòng đơn lưu snapshot công thức và định lượng; KDS, chi tiết đơn, giỏ và lịch sử hiển thị công thức. Pha chế trừ kho từ lượng đã giữ, hủy trước pha trả giữ như món thường. Sửa cấu hình sau đặt không sửa đơn cũ. Retry đơn đã thành công không tạo thêm đơn dù đề xuất đã hết hạn.
- Dùng được cho quà tại bàn: người gửi chọn bằng AI Barista, người nhận không thấy token riêng; khi tạo đơn vẫn phải đúng món đã chấp nhận. Nhận đơn member pickup qua luồng thanh toán/KDS có sẵn. Trang tạo đơn quầy giữ luồng chọn món hiện tại.
- Ảnh in tem #9 vẫn tùy chọn trên dòng Freestyle, không phụ phí. Không thay snapshot hóa đơn cũ hay tự thu tiền.

## API

Envelope `{success:true,data:...}`, `Cache-Control: no-store`. Guest/member mutation có CSRF và limiter AI dùng chung.

| API (prefix `/api/v1`) | Quyền và dữ liệu |
| --- | --- |
| `GET /ai/freestyle` | Cookie QR/member; trạng thái mở, giá/size, tên nền/vị |
| `POST /ai/freestyle` | `{context:TABLE|PICKUP,prompt,maxBudget?,preferences?}`; TABLE cần QR OPEN, PICKUP cần member; trả mode/message/recommendations |
| `POST /ai/freestyle/validate` | `{context,productId,token}`; kiểm lại trước thêm giỏ |
| `GET /admin/freestyle` | JWT ADMIN; settings/version/danh sách nguyên liệu |
| `PUT /admin/freestyle` | JWT ADMIN; `{requestId:UUID,expectedVersion,settings}` |

Input order/quote/gift có `freestyleToken` optional. ProductId ảo chỉ có hiệu lực cùng token đúng, variant null, đường/đá `Theo công thức`, topping rỗng. Client không được quyết định giá/công thức. Order DTO chỉ có `freestyle` công khai, không token/ID kho. Singleton + journal lưu cấu hình và audit/outbox trong transaction. Migration `20261023-002-freestyle-indexes` chỉ tạo index collection mới, không backfill dữ liệu cũ.

## Kịch bản nghiệm thu

1. Chưa cấu hình: tab báo chưa mở; Admin mặc định tắt/0 và kho không đổi.
2. Admin thiết lập một nền/hai vị, giá/size/đơn vị/hướng dẫn; Staff không sửa được. Save lỗi định lượng/ID lạ/nguyên liệu ngừng dùng/giá 0 khi bật không ghi một phần.
3. Hai Admin sửa cùng version: lần sau bị chặn, tải lại đúng bản mới. Ngắt mạng lúc lưu rồi thử lại chỉ ghi một lần.
4. QR OPEN: tab Freestyle trả món ngoài menu với đúng giá/size, mở công thức thấy đúng lượng; thêm giỏ, chỉnh số lượng, báo giá, đặt, thanh toán, KDS thấy công thức và bắt đầu pha trừ đúng kho.
5. Member pickup: đăng nhập, gợi ý, thêm giỏ mang đi, đặt ngay/hẹn giờ; giỏ tại bàn độc lập. Có cả cookie QR/member vẫn chọn đúng context.
6. Không caffeine/sữa: loại cả metadata chưa xác nhận; ngân sách thấp hơn giá không có gợi ý; không cà phê không chọn nền cà phê. Không đủ thành phần thì không gợi ý.
7. Hai vị xung khắc không đi chung; nền tối đa 1 vị không nhận 2; dùng chung nguyên liệu phải cộng lượng và kiểm giới hạn dung tích.
8. Model trả tên/giá/ID lạ hoặc provider lỗi: dùng fallback đã kiểm, không bán công thức bịa. AI off không gợi ý; fallback không gọi model.
9. Đề xuất quá 30 phút/đổi cấu hình/đổi đơn vị nguyên liệu/đổi participant/đóng hoặc CHECKOUT phiên: chặn thêm/đặt, yêu cầu tạo lại. Không mượn token từ tài khoản/phiên khác.
10. Giỏ trộn món thường/Freestyle cùng nguyên liệu, nhiều đơn cùng đặt: không vượt tồn. Hủy trả giữ; pha trừ đúng snapshot; sửa cấu hình không thay đơn đã đặt; retry không thêm giao dịch.
11. Gửi Freestyle làm quà, nhận chấp nhận rồi người gửi đặt/thu tiền/giao; token không lộ cho bên nhận. Tùy chọn ảnh tem #9 vẫn dùng được.
12. Kiểm trên điện thoại và máy quầy thật: bố cục/tab/modal không che nút, công thức đọc dễ, thử pha thực tế với nhân viên. Lightpanda chỉ chứng minh DOM/hành vi, chưa xác nhận bố cục trực quan hay hương vị/khả năng pha thực tế.
