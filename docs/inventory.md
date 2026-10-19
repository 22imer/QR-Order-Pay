# Kho nguyên liệu và công thức

## Sử dụng

Admin mở **Kho & công thức** (`/admin/inventory`):

1. Thêm nguyên liệu với mã duy nhất, tên, đơn vị cơ sở **g**, **ml** hoặc **đơn vị/cái**, và ngưỡng cảnh báo sắp hết. Mã và đơn vị không đổi sau khi tạo để giữ ý nghĩa lịch sử.
2. Bấm **Nhập / xuất / kiểm kê** để nhập tồn đầu hoặc nhập thêm. Xuất khác/hao hụt giảm tồn; kiểm kê nhập **tổng tồn thực tế**, bao gồm phần đang giữ cho đơn. Mỗi thao tác cần lý do.
3. Trong tab **Công thức**, chọn món hoặc topping, thêm định lượng cho **một phần** và bật áp dụng. Công thức nền dùng cho mọi size; công thức riêng của size **thay thế toàn bộ** nền. Topping cộng định lượng riêng theo mỗi phần món.
4. Tab **Lịch sử kho** có biến động nhập, xuất khác, kiểm kê, giữ, trả giữ và xuất pha chế; lọc nguyên liệu và phân trang 30 dòng. Lịch sử giữ tên/đơn vị, tồn sau, lượng giữ sau, đơn và người thao tác.

Số lượng có tối đa 3 chữ số thập phân. Ví dụ nhập 1 kg đường phải đổi sang **1000 g**, 1 lít sữa thành **1000 ml**. Một công thức bật cần ít nhất một nguyên liệu nền; không cho lặp nguyên liệu trong cùng công thức. Không quy đổi đơn vị tự động, tính nguyên liệu theo mức đường/đá, quản lý lô/hạn dùng hoặc giá vốn trong phiên bản này.

## Luồng tồn kho

- **Có thể dùng = tồn thực − đang giữ**. Cảnh báo sắp hết khi lượng có thể dùng không lớn hơn ngưỡng.
- **Báo giá**: kiểm tra nguyên liệu cho toàn bộ giỏ, cộng cả các dòng trùng và topping. Báo giá không giữ tồn.
- **Đặt đơn**: kiểm tra lại và giữ nguyên liệu trong cùng transaction với đơn/audit/outbox. Hai bàn tranh phần cuối không thể cùng thành công. Mỗi đơn lưu snapshot định lượng; sửa/tắt công thức sau đó không thay đổi nguyên liệu đã giữ cho đơn cũ.
- **Thu tiền từng phần/đủ, xác nhận đơn**: giữ nguyên phần nguyên liệu đã đặt trước.
- **Bắt đầu pha chế (`PREPARING`)**: giảm cả tồn thực và lượng giữ trong cùng transaction chuyển trạng thái. READY/SERVED không trừ thêm.
- **Hủy trước pha chế**: trả phần giữ. Đã thu tiền phải đi qua xác nhận hoàn tiền theo quy trình hiện có. Mọi đường chuyển CANCELLED dùng cùng xử lý kho.
- Nguyên liệu đã xuất pha chế không tự cộng lại khi điều chỉnh tiền. Hao hụt, sai tồn được ghi nhận bằng thao tác xuất khác/kiểm kê có lý do.
- Đơn chờ thanh toán **không tự hết hạn giữ kho**. Khi khách bỏ đơn, nhân viên hủy tại **Bàn & phiên → Chờ thanh toán** để giải phóng. Đơn đã thu một phần cần hoàn tiền trước khi hủy.

Không cho xuất/kiểm kê xuống dưới phần đang giữ, hoặc ngừng dùng nguyên liệu còn đang giữ. Ngừng nguyên liệu không còn giữ làm các công thức liên quan không khả dụng cho đơn mới.

## Tự báo hết món

Menu, featured, tìm kiếm, gợi ý AI, kiểm cấu hình AI và báo giá/đặt đơn đều áp dụng tồn kho. Hết nguyên liệu cho một size thì size đó không chọn được; mọi size hết thì món không còn trong danh sách bán. Topping hết nguyên liệu không còn trong danh sách chọn. Cấu hình món+topping có thể cùng tiêu thụ một nguyên liệu: backend kiểm tổng lần nữa trước khi đặt.

Tồn được đọc mới sau lớp cache catalog, nên outbox/Redis trễ không làm bỏ qua chốt chặn đặt món. Outbox phát `menu.availabilityChanged` để khách/nhân viên làm mới dữ liệu; trang kho và tình trạng món có polling dự phòng 10 giây. Nhập thêm nguyên liệu tự khôi phục khả năng bán khi đủ định lượng, **không bật lại cờ tạm ngừng bán thủ công**.

## API và bảo vệ dữ liệu

Prefix `/api/v1`; tất cả API quản lý sau chỉ ADMIN:

| Method | Endpoint                                             | Nội dung                                                |
| ------ | ---------------------------------------------------- | ------------------------------------------------------- |
| GET    | `/admin/inventory`                                   | Tồn, cảnh báo, công thức, món và topping                |
| POST   | `/admin/inventory/ingredients`                       | `{code,name,unit,lowStockThreshold}`; tồn ban đầu 0     |
| PATCH  | `/admin/inventory/ingredients/:id`                   | `{name,lowStockThreshold,isActive,expectedVersion}`     |
| POST   | `/admin/inventory/ingredients/:id/movements`         | `{type,quantity,reason,expectedVersion,idempotencyKey}` |
| GET    | `/admin/inventory/movements?page=1&ingredientId=...` | Sổ kho phân trang                                       |
| PUT    | `/admin/inventory/recipes/PRODUCT/:id`               | Công thức món                                           |
| PUT    | `/admin/inventory/recipes/TOPPING/:id`               | Công thức topping                                       |

Payload công thức: `{enabled,components:[{ingredientId,quantity}],variants:[{variantId,components:[{ingredientId,quantity}]}],expectedVersion}`. Công thức mới có expectedVersion=0. Cập nhật dùng version hiện tại từ GET. Topping không có variants.

Nhập/xuất/kiểm kê có idempotency key trong body, gắn với nguyên liệu/người dùng/nội dung, chống retry ghi trùng. Mất mạng hoặc HTTP 5xx giữ payload/key và khóa chỉnh sửa để thử lại cùng thao tác. Version không khớp trả 409 và yêu cầu tải lại. Kho và công thức có audit; biến động, trạng thái đơn và realtime outbox cùng commit/rollback.

MongoDB lưu lượng bằng số nguyên theo **1/1000 đơn vị cơ sở** để tránh cộng trừ số thực; API chuyển về g/ml/đơn vị. Snapshot kho nằm riêng trên Order, không được đưa vào DTO đơn khách hoặc Bill.

## Migration và tương thích

`20261019-001-inventory-indexes` tạo index cho Ingredient (mã unique), Recipe (một công thức mỗi đối tượng), StockMovement (idempotency unique có điều kiện và lịch sử). Chạy bằng migration runner hiện có; không seed/reset hoặc backfill đơn/catalog cũ.

Món/topping chưa bật công thức tiếp tục dùng trạng thái bán thủ công. Đơn cũ không có snapshot kho tiếp tục xử lý mà không tự trừ nguyên liệu. Cần Admin nhập tồn và bật công thức thật sau triển khai; không tự suy đoán định lượng từ tên món.
