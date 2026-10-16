# Thu tiền và điều chỉnh khoản thu

## Quy trình tại quán

**Mã khoản thu** trên trang Khoản thu là ID nội bộ của từng lần ghi nhận tiền (`Payment._id`), không phải mã giao dịch ngân hàng hay mã đơn. Một đơn 90.000đ thu hai lần 40.000đ và 50.000đ có hai mã khoản thu cùng gắn với mã đơn đó. ID này giúp xác định đúng lần thu cần hoàn/đảo/sửa phương thức/chuyển đơn, liên kết khoản thay thế với khoản gốc và đối soát người thu/thời điểm/ca. `Idempotency-Key` là khóa kỹ thuật riêng để việc gửi lại request không ghi trùng tiền; mã khoản thu hiển thị không tự xác nhận tiền vào ngân hàng.

1. **Staff → Bàn & phiên → Kiểm tra & nhận tiền**: server cấp quyền thu tiền của phiên bàn cho đúng tài khoản và cửa sổ đang thao tác. Quyền có hạn 120 giây, giao diện gia hạn mỗi 30 giây khi hộp thoại mở. Nhân viên khác nhận thông báo bàn đang được thu. Đóng hộp thoại trả quyền; server cũng trả quyền trong transaction khi ghi nhận thu/hoàn thành công. Mất kết nối/đóng trình duyệt trước xác nhận thì quyền tự hết hạn.
2. Nhập **Số tiền thực nhận (VND)**, chọn phương thức đã kiểm tra. Server không nhận số tiền âm, lẻ hoặc vượt số còn thiếu. Khoản thu một phần được lưu ngay; `paidAmount` và `balanceDue` hiển thị cho khách và nhân viên. Đơn giữ `AWAITING_PAYMENT / UNPAID` đến khi đủ tổng tiền, rồi chuyển `PENDING / PAID` vào KDS. Một đơn có thể có nhiều khoản thu/phương thức.
3. Hủy đơn chưa nhận tiền dùng thao tác hủy thông thường. Đơn đã nhận một phần không được hủy trực tiếp: khách gửi yêu cầu nhân viên hủy; nhân viên xác nhận đã hoàn lại số tiền thực nhận. Tất cả khoản thu còn hiệu lực của đơn được hoàn trong cùng transaction, đơn chuyển `CANCELLED / REFUNDED`. Chỉ áp dụng khi chưa pha chế. Việc hoàn tiền ngân hàng/tiền mặt do nhân viên thực hiện; phần mềm ghi nhận sau khi kiểm tra.
4. Nếu ghi nhận nhầm, vào **Staff → Khoản thu → Yêu cầu điều chỉnh**, chọn khoản thu và nhập lý do:

   | Loại | Kết quả khi quản lý duyệt |
   | --- | --- |
   | Hủy ghi nhận thu | Đảo khoản đã ghi nhầm, khôi phục số còn thiếu của đơn nguồn. Không tự chuyển tiền. |
   | Sửa phương thức | Đảo khoản cũ và tạo khoản thay thế cùng số tiền, liên kết `replacesPaymentId`, dùng phương thức đúng. |
   | Chuyển sang đúng đơn | Đảo khoản ở đơn nguồn, tạo khoản thay thế ở đơn đích đang chờ thanh toán; không vượt số đích còn thiếu. |

5. **Admin → Khoản thu → Chờ duyệt**: đối chiếu bàn, mã đơn, số tiền, phương thức cũ/mới, lý do và nhập ghi chú duyệt/từ chối. Người lập yêu cầu không tự duyệt. Hai quản lý cùng duyệt chỉ một người thành công. Khi chờ duyệt, đơn nguồn/đích bị giữ các thao tác thu, hủy, chuyển KDS và đóng phiên liên quan.
6. **Ca thu ngân**: tiền dự kiến tính các khoản vào, hoàn thực tế và đảo ghi nhận theo ca phát sinh. Không chốt ca khi có bàn đang giữ quyền thu tiền. Có chênh lệch kiểm đếm thì bắt buộc nhập lý do; hệ thống lưu người chốt, số dự kiến, số đếm, chênh lệch và ghi chú.

## Quy tắc và giới hạn

- Quyền thu áp dụng cho toàn phiên bàn, bao gồm luồng thanh toán gộp dữ liệu cũ. API nhận tiền bắt buộc có `X-Payment-Claim` của đúng người, đúng cửa sổ, còn hạn. Token lưu dưới dạng hash và bị che trong log.
- Payment, Order, phiên bàn, ca, audit và outbox được ghi trong transaction MongoDB replica set. `expectedVersion` ngăn ghi lên trạng thái cũ; `Idempotency-Key` ngăn thu lặp. Gửi lại cùng key/payload/người thu trả khoản cũ, kể cả quyền thu đã hết hạn. Đổi payload/người thu với key cũ trả 409.
- Khi chưa rõ kết quả do mất kết nối, giao diện giữ payload và key để thử lại, khóa đổi số tiền/phương thức. Không nhận thêm tiền chỉ vì chưa thấy phản hồi.
- Hủy ghi nhận/chuyển khoản thu sang đơn khác chỉ áp dụng khi đơn nguồn chưa pha chế và phiên còn hoạt động. Khoản thu cũ gộp nhiều đơn cần đối soát riêng; API không tự chia tiền.
- Sửa phương thức được phép sau đóng phiên. `Bill` đã chốt không sửa; lịch sử điều chỉnh liên kết khoản thu gốc dùng để đối soát. Chưa có hoàn sau pha chế/đóng phiên, hoàn một phần một khoản thu, hay giảm giá sau bán.
- Giữ quyền thu không xác minh giao dịch ngân hàng và không thể ngăn nhận tiền ngoài phần mềm. Nhân viên vẫn cần kiểm tra số tiền thực nhận trước khi xác nhận.
- Lý do chênh lệch ca là bắt buộc; chưa có bước duyệt chênh lệch ca riêng của quản lý.

## Báo cáo

- Tiền đã thu: khoản thu ban đầu theo `paidAt`, kể cả khoản sau này đã hoàn/đảo.
- Tiền đã hoàn: hoàn thực tế theo `refundedAt`.
- Điều chỉnh: khoản thay thế trừ khoản đảo theo thời điểm điều chỉnh. Sửa phương thức/chuyển đơn không làm tăng tổng thực thu; hủy ghi nhận giảm tổng thực thu.
- **Thực thu ròng = tiền đã thu − tiền đã hoàn + điều chỉnh**. Ngày chỉ hoàn khoản thu hôm trước có thể âm. Biểu đồ ngày/giờ và CSV dùng cùng cách tính, múi giờ `Asia/Ho_Chi_Minh`.
- Số đơn có thu tiền là số mã đơn khác nhau trong khoản thu ban đầu của khoảng lọc. Top 5 món vẫn theo ngày tạo đơn đã thanh toán và giá trị món; giao diện ghi rõ hai phạm vi này.

## File quan trọng

- `server/src/services/paymentClaimService.ts`: giữ/gia hạn/trả quyền, khóa ghi phiên và ca.
- `server/src/services/paymentService.ts`: thu từng phần, idempotency, hóa đơn và thanh toán cũ.
- `server/src/services/paymentCorrectionService.ts`, `models/PaymentCorrection.ts`: yêu cầu, duyệt, đảo và thay thế khoản thu.
- `server/src/services/orderRefundService.ts`: hoàn các khoản đã thu trước pha chế.
- `server/src/services/paymentAnalyticsService.ts`, `cashShiftService.ts`: dòng tiền theo thời gian và ca.
- `client/src/features/staff/AwaitingPayments.tsx`, `PaymentAccounting.tsx`, `usePaymentClaim.ts`: giao diện thu/điều chỉnh.
- `server/scripts/migrate.ts`: index bổ sung, không reset dữ liệu; `paidAmount: null` của dữ liệu cũ được đọc tương thích.

## Hiển thị gọn — 15/10/2026

Trang Khoản thu ưu tiên bàn, mã đơn, số tiền, phương thức, thời gian và trạng thái. Mã khoản thu đầy đủ và mã khoản bị thay thế nằm trong **Chi tiết**; dữ liệu và yêu cầu duyệt được giữ nguyên. Hướng dẫn dài nằm trong **Quy định điều chỉnh**.
