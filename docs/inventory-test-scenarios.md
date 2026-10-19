# Kịch bản test kho — Fantastic cafe

Dữ liệu đã nạp ngày **19/10/2026**: **32 nguyên liệu**, **32 phiếu nhập tồn đầu**, **22 công thức món và 6 công thức topping**. Bộ mẫu theo menu đang có, không đổi tên/giá/ảnh hoặc khôi phục món đã xóa. Công thức là định lượng minh họa cho BTL, có thể sửa theo công thức thực tế của quán.

## Chuẩn bị

- Kho Admin: <http://localhost:8082/admin/inventory>.
- Nhân viên: <http://localhost:8081/staff/tables>; tình trạng món: <http://localhost:8081/staff/availability>.
- Menu khách: <http://localhost:8080/menu>. Muốn đặt đơn, vào phiên bàn bằng màn hình QR/link còn hạn do bạn chọn ở Staff/Admin. Xem menu trực tiếp chưa cấp quyền đặt món.
- Dùng hai tài khoản Admin/Staff và cửa sổ thường/ẩn danh cho khách. Hai tab cùng trình duyệt có thể dùng chung danh tính khách; test nhiều khách dùng profile khác hoặc cửa sổ ẩn danh.
- Mở **Nguyên liệu**, **Công thức**, **Lịch sử kho** ở Admin. Nhấn Ctrl+F5 nếu giao diện cũ; các thay đổi kho tới khách đã vào bàn qua realtime, Staff/kho có polling 10 giây. Nếu xem menu công khai chưa vào bàn, tải lại để đối chiếu.
- **Tồn thực = nguyên liệu chưa xuất pha chế; đang giữ = nguyên liệu của đơn chưa pha; có thể dùng = tồn thực − đang giữ.** Đặt đơn giữ kho, thu tiền chưa xuất kho; chỉ PREPARING mới xuất thực.
- Ghi lại tồn trước mỗi ca. Các con số tồn tuyệt đối dưới đây giả sử chưa có test trước đó; nếu đã dùng, so sánh theo mức tăng/giảm. Không kiểm kê thấp hơn lượng đang giữ. Trước các ca đổi tồn, xử lý/hủy hết đơn đang giữ nguyên liệu đó; hủy đơn đã thu tiền phải xác nhận hoàn theo quy trình hiện tại.
- Thu/hoàn tiền và pha chế khi bạn test sẽ để lại lịch sử nghiệp vụ demo. Bộ nạp không tự xóa các giao dịch này.

## 1. Kiểm tra dữ liệu ban đầu

1. Mở kho, kiểm tra 32 nguyên liệu và 28 công thức bật.
2. Kiểm tra ví dụ: cà phê hạt **1000 g**, sữa tươi **5000 ml**, sả **200 g**, trân châu trắng **1000 g**, croissant **30 cái**. Ban đầu đang giữ bằng 0.
3. Trong Công thức chọn Espresso Mây: S **18 g**, M **24 g**, L **30 g** cà phê. Chọn Trà Đào Cam Sả: M **5 g sả**, L **8 g sả**.
4. Lịch sử có 32 dòng Nhập kho, có lý do chứa `fantastic-inventory-demo-v1`. Danh sách phân trang 30 dòng, nên kiểm tra cả trang 2; sau khi bạn test sẽ có thêm dòng.

**Mong đợi:** các món/size/topping đang bật bán đều đủ nguyên liệu; không có cảnh báo sắp hết ở tồn đầu. Bánh được quản lý như thành phẩm/phần/cái. Ba món đã xóa không được tự khôi phục.

## 2. Đặt đơn giữ kho và hủy trả giữ

1. Khách đặt **2 Espresso Mây size S**, chưa thanh toán.
2. Xem Cà phê hạt rang: tồn thực vẫn **1000 g**, đang giữ **36 g**, có thể dùng **964 g**.
3. Hủy đơn từ phía khách, hoặc Staff hủy đơn chưa thu tiền trong Chờ thanh toán.

**Mong đợi:** sau hủy, tồn vẫn **1000 g**, đang giữ về **0**, có thể dùng **1000 g**; lịch sử có Giữ cho đơn **36 g** và Trả phần giữ **36 g**. Đơn chưa trả tiền không xuất hiện ở KDS.

## 3. Thu từng phần, đủ tiền và xuất khi pha chế

1. Tạo đơn mới **1 Espresso Mây size M**: giá hiện tại **45.000đ**, giữ **24 g** cà phê.
2. Staff thu **10.000đ**: đơn vẫn chờ tiền, còn **35.000đ**, kho chưa xuất thực, KDS chưa có đơn.
3. Thu thêm **35.000đ**: đơn vào KDS; tồn thực vẫn bằng trước đặt, đang giữ vẫn **24 g**.
4. KDS nhận/xác nhận đơn: chưa xuất thực. Chuyển **Đang pha chế**: tồn thực giảm **24 g**, đang giữ giảm **24 g**.
5. Chuyển Sẵn sàng → Đã phục vụ; làm mới trang.

**Mong đợi:** nếu bắt đầu với 1000 g thì còn **976 g**, đang giữ 0; chỉ một dòng Xuất pha chế cho nguyên liệu của đơn. READY/SERVED/reload không trừ thêm. Khi đủ điều kiện, đóng phiên và in hóa đơn theo luồng bình thường.

## 4. Công thức món + topping + số lượng

1. Khách chọn **Trà Đào Cam Sả M**, thêm **Trân châu trắng**, số lượng **2**, rồi đặt.
2. Đối chiếu phần đang giữ tăng theo bảng:

| Nguyên liệu                     | Giữ thêm |
| ------------------------------- | -------: |
| Cốt trà trái cây không caffeine |   360 ml |
| Đào miếng                       |    120 g |
| Cam tươi sơ chế                 |     60 g |
| Sả tươi                         |     10 g |
| Trân châu trắng đã chuẩn bị     |    100 g |

**Mong đợi:** tổng giá **100.000đ** = 2 × (42.000 + 8.000); tồn thực chưa đổi. Hủy đơn chưa thu tiền để trả toàn bộ các lượng giữ trên. Topping chỉ chọn được trên món đã liên kết sẵn; bộ dữ liệu không tự thay liên kết topping của menu.

## 5. Hết riêng size lớn

1. Đảm bảo Sả tươi không còn lượng đang giữ; ghi lại tồn sả ban đầu.
2. Admin → Sả tươi → Nhập/xuất/kiểm kê → **Kiểm kê tồn thực tế = 6 g**, lý do `Test hết riêng size L`.
3. Khách mở Trà Đào Cam Sả.

**Mong đợi:** size **M** còn chọn được vì cần 5 g; size **L** bị khóa vì cần 8 g. Admin hiện cảnh báo sả sắp hết; Staff thấy nhãn thiếu nguyên liệu ở size L. Một giỏ gồm 2 ly M cũng không đặt được vì cần tổng 10 g, dù mỗi ly riêng cần 5 g.

**Khôi phục:** không gửi đơn hoặc hủy mọi đơn vừa tạo; kiểm kê sả về tồn đã ghi (mẫu ban đầu **200 g**), có lý do khôi phục. Size L bán lại.

## 6. Hết toàn món, giỏ cũ và nhập lại

1. Trước khi đổi tồn, khách thêm Trà Đào Cam Sả vào giỏ, chưa đặt.
2. Khi sả không có lượng giữ, Admin kiểm kê **Sả tươi = 0 g**.
3. Khách thử gửi giỏ cũ, tìm Trà Đào Cam Sả trong menu/tìm kiếm và hỏi AI gợi ý món liên quan.

**Mong đợi:** giỏ bị chặn do thiếu nguyên liệu; không tạo đơn mới. Món không còn trong danh sách bán hoặc kết quả tìm kiếm/gợi ý AI khả dụng; Staff có cảnh báo thiếu nguyên liệu. Các món không dùng sả vẫn bán được.

**Khôi phục:** Nhập kho **200 g sả** khi hiện bằng 0 (hoặc nhập đúng tồn gốc đã ghi), ghi lý do. Menu và size bán lại; không phải sửa cờ Đang bán của món.

## 7. Hết riêng topping

1. Khi Trân châu trắng không có lượng giữ, kiểm kê nguyên liệu **Trân châu trắng đã chuẩn bị = 0 g**.
2. Khách mở Trà Đào Cam Sả; thử một giỏ cũ đã chọn topping này.

**Mong đợi:** Trà Đào Cam Sả vẫn bán được nếu các nguyên liệu nền đủ; Trân châu trắng không còn chọn được. Giỏ cũ có topping bị chặn. Staff thấy topping thiếu nguyên liệu.

**Khôi phục:** nhập lại đúng tồn ban đầu (mẫu **1000 g** nếu vừa kiểm kê về 0); topping xuất hiện lại.

## 8. Hai khách tranh phần cuối

1. Khi Croissant thành phẩm không có lượng giữ, kiểm kê còn **1 cái**.
2. Hai khách ở hai browser profile/thiết bị vào bàn hợp lệ, cùng thêm **1 Bánh Croissant** vào giỏ trước khi đặt.
3. Hai khách bấm Đặt món gần đồng thời.

**Mong đợi:** chỉ một đơn được tạo; khách còn lại nhận lỗi hết món/thiếu nguyên liệu. Tồn thực croissant **1**, đang giữ **1**, có thể dùng **0**; không âm hoặc giữ thành 2. Khách có đơn thành công bấm hủy thì đang giữ về 0 và món bán lại.

**Khôi phục:** hủy đơn thành công chưa thu tiền, kiểm kê croissant về tồn gốc (mẫu **30 cái**).

## 9. Chặn kiểm kê và ngừng dùng khi còn giữ

1. Đặt **2 Espresso S**, giữ **36 g** cà phê, chưa thu tiền.
2. Admin thử kiểm kê cà phê về **20 g**.
3. Thử sửa nguyên liệu cà phê và bỏ chọn Đang dùng.

**Mong đợi:** cả hai thao tác bị từ chối, tồn/cờ Đang dùng không đổi; phần giữ 36 g vẫn còn. Không có dòng kiểm kê thành công cho yêu cầu bị chặn.

**Khôi phục:** hủy đơn để trả giữ; không cần nhập bù vì tồn thực chưa bị trừ.

## 10. Hoàn tiền trước pha chế

1. Tạo **1 Espresso S**, giữ **18 g**; Staff thu **10.000đ** trong tổng **35.000đ**.
2. Khách yêu cầu hủy. Staff duyệt và xác nhận đã hoàn **10.000đ** bằng phương thức tương ứng, hoặc dùng thao tác hoàn/hủy mà giao diện cung cấp.

**Mong đợi:** đơn bị hủy, khoản thu chuyển hoàn, phần giữ giảm 18 g, tồn thực không giảm. Không thể hủy như đơn chưa thu tiền để bỏ qua bước hoàn; sau khi đã PREPARING thì không thể dùng luồng hủy trước pha chế này.

## 11. Công thức mới không đổi đơn cũ

1. Tạo **đơn A: 1 Espresso S**, ghi nhận đang giữ **18 g**.
2. Admin mở Công thức Espresso Mây, đổi **công thức riêng size S** từ 18 thành **20 g**, lưu. Không chỉ sửa nền vì S đang có công thức riêng.
3. Tạo **đơn B: 1 Espresso S**: giữ thêm **20 g**, tổng A+B là **38 g**.
4. Hủy A: trả đúng **18 g**, B còn giữ 20 g. Hủy B: trả đúng 20 g.

**Mong đợi:** snapshot cũ được giữ nguyên, không trả theo công thức 20 g mới. Nếu muốn thử pha chế, có thể thu đủ và pha A thay cho hủy: A chỉ xuất 18 g, B vẫn theo 20 g.

**Khôi phục:** đưa công thức riêng S về **18 g**; lượng đã pha chế là tiêu hao thật trong dữ liệu demo, không tự hoàn kho.

## 12. Hai tab Admin sửa cùng tồn và phân quyền

1. Mở hai tab Admin, cùng mở form nhập **Pudding trứng thành phẩm** trước khi lưu bất kỳ tab nào; ghi lại tồn gốc.
2. Tab A nhập thêm **1 cái**. Tab B gửi form cũ nhập thêm 1 cái.

**Mong đợi:** A thành công, B bị từ chối do version đã thay đổi; chỉ tăng tổng **1 cái** và có một phiếu nhập mới. Đóng form B, tải lại trước khi thử tiếp. Sau test có thể kiểm kê về tồn gốc nếu không có đơn đang giữ pudding.

Đăng nhập Staff: không có menu quản lý kho và không được thêm/sửa nguyên liệu, công thức hoặc kiểm kê. API quản lý kho yêu cầu ADMIN; Staff chỉ xem tình trạng món và bật/tắt bán thủ công.

## Chạy lại bộ nạp

Từ thư mục dự án, đặt `INVENTORY_ADMIN_PASSWORD` trong môi trường process rồi chạy:

```powershell
node scripts/setup-inventory-demo.mjs          # xem/kiểm tra kế hoạch
node scripts/setup-inventory-demo.mjs --apply  # chỉ thêm thiếu, receipt cùng key được replay
```

Không chạy `npm run seed`: đó là seed tổng có thể thay dữ liệu demo. Bộ nạp kho **không reset tồn về mức ban đầu**, không ghi đè công thức đã sửa và không tự dọn đơn/tiền sau test. Nếu đã đổi công thức, nó báo khác dữ liệu và dừng; khôi phục có chủ đích ở Admin theo từng ca test.

Lý do nhập tồn gắn `fantastic-inventory-demo-v1`. Cùng tài khoản Admin chạy lại bộ nạp: không tạo thêm nguyên liệu/công thức và không nhập tồn lần hai. Danh sách đầy đủ và định lượng nằm tại [Bộ dữ liệu kho](inventory-demo-data.md) và [JSON dữ liệu](data/inventory-demo.json).
