# Bối cảnh thiết kế Fantastic cafe

Nguồn: README, contracts, model/service và giao diện hiện có. Áp dụng cho cả Khách, Nhân viên và Quản trị theo yêu cầu ngày 13/10/2026.

## Mục đích và ưu tiên

Tên sản phẩm trong [README](../README.md): **Fantastic cafe — QR Ordering & AI Barista**. Đây là hệ thống MERN đặt đồ uống qua QR tại bàn cho một quán cà phê, có AI Barista tư vấn từ menu thật; mục tiêu là bài tập lớn Lập trình Web với dữ liệu thật, kiến trúc phân tầng, kiểm thử và tài liệu.

README mở đầu danh sách tính năng bằng **QR tự đổi mỗi 60 giây**, sau đó là thực đơn và tùy chỉnh món. Vì vậy lối vào bằng QR và thao tác chọn món là trọng tâm của cổng khách. Các số liệu doanh thu thuộc cổng quản trị và đứng sau thao tác phục vụ/quản lý trong thứ bậc giao diện.

## Hình dạng nghiệp vụ quyết định bố cục

### Trang thực đơn theo ảnh tham chiếu

Theo yêu cầu ngày 13/10/2026, `/menu` dùng hero ảnh nền phủ màn hình và carousel thẻ món. Ảnh, tên, mô tả, danh mục và giá lấy từ catalog; bấm thẻ chỉ đổi món đang xem, **Chọn món** mở cấu hình gọi món. Desktop hiển thị nội dung trái/thẻ phải; mobile xếp dọc và vuốt ngang. Header phủ lên ảnh ở riêng route menu. Font Be Vietnam Pro và màu xanh/gold hiện có được giữ qua lớp ảnh/gradient; không có autoplay để khách đọc mô tả và thao tác chủ động.

`MenuShowcase.tsx`, `MenuPhoto.tsx`, `menuImages.ts`, `menu-showcase.css` là các file chính. `client/public/menu-images/SOURCES.md` ghi nguồn ảnh từ Product.image thật; URL không phải ảnh dùng nền/icon dự phòng, không gán ảnh món khác.

### Cửa sổ và bề mặt khách đồng bộ với thực đơn

Theo yêu cầu tiếp theo ngày 13/10/2026, theme khách chuyển sang xanh đậm/chữ sáng/vàng để cửa sổ AI và các thành phần đi cùng nền ảnh. `styles/guest-surfaces.css` định nghĩa bề mặt, viền, overlay mờ, header/đóng, thẻ gợi ý và dock; token nằm ở `index.css`, áp qua `useGuestTheme` cả các portal Radix ở body. Staff/Admin vẫn dùng token nền kem hiện có. Khi in, token khách chuyển sang giấy trắng/chữ xanh đậm.

AI Barista dùng nội dung/preset sẵn có, nhãn mô tả khẩu vị rõ ràng, trạng thái chọn và đang hỏi, kết quả có ảnh catalog qua MenuPhoto, lý do/size/caffeine/sữa/giá và nhãn fallback từ API. Kết quả mới cuộn vào vùng xem, header cửa sổ dài giữ nút đóng. Size/đường/đá, bộ lọc, giỏ/phiếu đơn, đánh giá và vào bàn kế thừa cùng bảng màu. QR vẫn là ảnh đen trắng có nền trắng của thư viện qrcode.

- **Khách:** danh mục → món → size/đường/đá/topping → giỏ → đơn. Product chứa ảnh, mô tả, basePrice, variants, allowedOptions, isAvailable/isArchived/isFeatured. Danh mục và món là cấu trúc chính của trang menu; AI Barista là hỗ trợ chọn món.
- **Nhân viên:** hàng chờ thu tiền → các cột KDS → phục vụ. Đơn mới `AWAITING_PAYMENT / UNPAID`; nhận đủ tiền mới `PENDING / PAID`. KDS dùng các nhãn **Chờ xác nhận**, **Đã nhận**, **Đang pha**, **Sẵn sàng**. Không đưa đơn chưa trả tiền vào hàng pha chế.
- **Quản trị:** bàn/QR, món/danh mục/topping, hóa đơn, nhân viên, đánh giá và báo cáo. Các thao tác quản lý dùng route và quyền hiện có; số liệu lấy API/report job thật.
- **Phiên bàn:** `OPEN`, `CHECKOUT`, `CLOSED`; một phiên hoạt động cho mỗi bàn. Đánh giá gắn với đơn `SERVED + PAID`, mỗi đơn một lần; đánh giá không kết thúc phiên. Chỉ đóng phiên mới chốt Bill và thu hồi quyền gọi món.

## File quan trọng

[InternalShell.tsx](../client/src/components/layout/InternalShell.tsx) dùng chung thanh bên desktop và điều hướng cuộn trên mobile cho Staff/Admin.

| File                                                                                                                                                                                                      | Vai trò                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [README.md](../README.md), [PROJECT_MEMORY.md](../PROJECT_MEMORY.md)                                                                                                                                      | Mục đích, phạm vi, luồng mới nhất và những giới hạn đã biết        |
| [client/src/App.tsx](../client/src/App.tsx)                                                                                                                                                               | Route, portal Khách/Staff/Admin và áp theme khách                  |
| [client/src/styles/index.css](../client/src/styles/index.css), [tailwind.config.js](../client/tailwind.config.js)                                                                                         | Token màu/chữ, phiếu gọi món, sheet, spacing và component styles   |
| [client/src/layouts](../client/src/layouts)                                                                                                                                                               | Điều hướng và trạng thái phiên/kết nối theo vai trò                |
| [client/src/features/guest/MenuPage.tsx](../client/src/features/guest/MenuPage.tsx), [ProductDetailModal.tsx](../client/src/features/guest/ProductDetailModal.tsx)                                        | Catalog theo danh mục và tùy chọn món từ dữ liệu thật              |
| [client/src/features/guest/TableDisplayPage.tsx](../client/src/features/guest/TableDisplayPage.tsx), [JoinPage.tsx](../client/src/features/guest/JoinPage.tsx)                                            | QR có hạn, link vào bàn và lỗi tham gia phiên                      |
| [client/src/features/staff/KDS.tsx](../client/src/features/staff/KDS.tsx), [AwaitingPayments.tsx](../client/src/features/staff/AwaitingPayments.tsx)                                                      | Các công đoạn và nhận tiền từng đơn                                |
| [client/src/features/admin](../client/src/features/admin)                                                                                                                                                 | Quản lý catalog/bàn/nhân viên, hóa đơn và số liệu thực             |
| [packages/contracts/src/schemas.ts](../packages/contracts/src/schemas.ts)                                                                                                                                 | Trạng thái, quyền, phương thức thanh toán và DTO dùng chung        |
| [server/src/models/Product.ts](../server/src/models/Product.ts), [TableSession.ts](../server/src/models/TableSession.ts)                                                                                  | Cấu trúc món, lựa chọn và vòng đời phiên                           |
| [server/src/services/orderService.ts](../server/src/services/orderService.ts), [paymentService.ts](../server/src/services/paymentService.ts), [reviewService.ts](../server/src/services/reviewService.ts) | Điều kiện đặt, nhận tiền, chuyển công đoạn và đánh giá             |
| [compose.production.yaml](../compose.production.yaml), [docker/nginx/default.conf](../docker/nginx/default.conf)                                                                                          | Portal Khách 8080, Staff 8081, Admin 8082 và tách API theo vai trò |

## Nhận diện cần kế thừa

| Token          | Khách               | Nhân viên/Quản trị |
| -------------- | ------------------- | ------------------ |
| Nền            | `#101D18`           | `#FAF7F2`          |
| Chữ            | `#F6F3EB`           | `#2B2118`          |
| Primary        | `#F4A21D`           | `#285943`          |
| Accent         | `#F4A21D`           | `#C88A4D`          |
| Card           | `#1B2B23`           | `#FFFFFF`          |
| Font giao diện | Be Vietnam Pro     | Be Vietnam Pro     |
| Font tiêu đề   | Be Vietnam Pro     | Be Vietnam Pro     |

Các giá trị lấy từ CSS đang triển khai. Theme khách chỉ áp trên portal/path khách, bao gồm cửa sổ Radix. Nút bo tròn với chiều cao 36/40/48 px; card bo `rounded-2xl`, bóng `soft`; modal dùng Radix. Guest có dấu mây SVG, thanh điều hướng dưới trên điện thoại, dòng món có ảnh và phiếu hóa đơn mép răng cưa. Giữ những đặc điểm này khi cải thiện bố cục.

Theo yêu cầu đổi tên và kiểu chữ ngày 13/10/2026, tên hiển thị là **Fantastic cafe** và cả ba portal dùng **Be Vietnam Pro**, weight 400/500/600/700/800. Font WOFF2 và giấy phép OFL nằm trong `client/public/fonts/`, được phục vụ/cached cùng ứng dụng. Tiêu đề khách dùng weight 700, tiêu đề phụ 600; không dùng font hẹp hoặc serif cũ.

## Nội dung thật

- Heading menu: **Hôm nay uống gì?**; tìm kiếm **Tìm món**; hỗ trợ **Hỏi AI Barista**; nhóm nổi bật **Đề xuất hôm nay**.
- Điều hướng khách: **Thực đơn**, **AI Barista**, **Đơn của tôi**, **Gọi nhân viên**; sau đóng phiên chuyển sang **Hóa đơn**.
- Staff: **KDS**, **Bàn & phiên**, **Yêu cầu**, **Hết món**, **Ca thu ngân**.
- Admin: **Dashboard**, **Vận hành**, **Hóa đơn**, **Món**, **Danh mục**, **Topping**, **Bàn & QR**, **Nhân viên**, **Đánh giá**.
- Menu public thực tế đọc ngày 13/10/2026 có **Espresso Mây**, **Bạc Xỉu Đá**, **Cà phê Dừa**, **Americano**, **Cappuccino**; tên/giá/ảnh hiển thị vẫn lấy API ở thời điểm dùng, không hardcode từ bản ghi này.
- Thông báo QR: **QR đã hết hạn hoặc bị thu hồi. Vui lòng quét mã mới trên màn hình tại bàn.** Hiển thị đúng lỗi server thay vì dẫn khách dùng QR tĩnh cũ.

## Mục tiêu triển khai

1. Khách thấy món và thao tác chọn/đặt trước phần hỗ trợ; QR/link vào bàn rõ ràng, giữ trải nghiệm dùng một tay trên điện thoại.
2. Nhân viên nhìn rõ đơn chờ thu tiền và các công đoạn, trạng thái/số lượng lấy dữ liệu thật; nhận diện bàn và hành động tiếp theo nổi bật.
3. Quản trị có điều hướng quản lý nhất quán, bàn/QR và catalog dễ truy cập, báo cáo vẫn đúng bộ lọc và quyền.
4. Cả ba portal sử dụng token/component hiện có, hỗ trợ kích thước mobile/tablet/desktop và trạng thái tải/rỗng/lỗi. Không thêm dữ liệu thống kê, chứng thực khách hàng, ưu đãi hoặc tính năng chưa tồn tại.
5. Giữ các điều kiện thanh toán, quyền sở hữu đơn, đánh giá từng đơn, hóa đơn bất biến và phân quyền HTTP/socket. Không mở rộng sang nhiều chi nhánh, giao hàng, kho nguyên liệu hay cổng thanh toán tự động.
