# Đặt bàn theo khung giờ (#10)

## Cách dùng

- Khách mở **`/reservations`**, đăng nhập tại `/reservations/member` bằng tài khoản thành viên hiện có. Không cần QR. Chọn ngày/giờ Việt Nam, số khách, **Tìm bàn trống**, chọn bàn rồi xác nhận tên/SĐT/ghi chú. Lịch đã đặt ở **Lịch của tôi** (`/reservations/mine`), có hủy kèm lý do và lịch sử.
- Mỗi lượt **60 phút** theo lựa chọn của user. Giờ bắt đầu từ 15 phút tới 7 ngày tới; tối đa 30 khách, một bàn đủ chỗ, không ghép bàn. Hai khoảng `[bắt đầu, kết thúc)` không được chồng nhau; có thể đặt tiếp đúng thời điểm lượt trước kết thúc. Giờ máy khác múi giờ vẫn gửi/hiển thị UTC+7.
- Thành viên tối đa 3 lịch đang xử lý, không tự đặt hai bàn trùng thời gian. Staff/Admin tạo tại quầy tại `/staff/reservations`, `/admin/reservations`, không tự gán thành viên hoặc điểm theo SĐT. Tạo lịch giữ chỗ ngay, không tạo phiên gọi món, đơn, khoản thu hoặc điểm.
- Staff/Admin **Xử lý lịch đặt → Khách đã đến — Check-in** trong khoảng từ 15 phút trước giờ bắt đầu đến trước hạn đến. Tại đúng giờ hẹn +15 phút, lịch hết hạn; không check-in nữa. Bàn phải hoạt động, đủ chỗ và không còn phiên cũ. Check-in mở đúng một phiên `STAFF`, sau đó khách **quét QR tại bàn** để gọi món như thường.
- Trạng thái: `CONFIRMED` → `CHECKED_IN` → `COMPLETED`; hoặc `CONFIRMED` → `CANCELLED` / `NO_SHOW`. Khách chỉ hủy lịch chính chủ chưa check-in/chưa quá hạn; nhập lý do 3–280 ký tự. Đã check-in thì xử lý qua phiên phục vụ. Khi phiên đóng bình thường hoặc đóng qua thanh toán, lịch hoàn tất trong cùng transaction. Không tự đóng phiên hoặc xử lý tiền khi đủ 60 phút.
- Scheduler quét no-show mỗi 30 giây; danh sách cũng quét khi tải. Khả dụng bỏ qua lịch quá hạn ngay cả khi worker chưa quét. Không dùng TTL để xóa lịch sử. Hết hạn chỉ nhả giữ chỗ, không tạo/hủy giao dịch tiền.

## Quan hệ với khách đang ngồi

- Khi tìm/đặt cho **60 phút tới**, bàn có phiên `OPEN` hoặc `CHECKOUT` bị loại. Có thể lên lịch xa hơn khi bàn hiện đang phục vụ; thời điểm đến nhân viên vẫn phải bảo đảm phiên trước đã kết thúc.
- QR tự mở phiên, nhân viên mở phiên thủ công và chuyển bàn đều bị chặn nếu bàn đích có lịch giữ chỗ trong 60 phút tới. Khách trong phiên đang mở vẫn quét QR tham gia cùng phiên. Đặt chỗ không tự đẩy khách đang ngồi ra khỏi bàn.
- Nếu khách trước ngồi quá giờ, check-in báo bàn còn phiên; nhân viên dọn bàn, xử lý đơn/tiền và đóng phiên cũ theo quy trình rồi thử lại trong hạn đến. Bản đầu chưa có đổi bàn/giờ của lịch chưa check-in hoặc ghép bàn.
- Chuyển phiên **đã check-in** sang bàn khác sẽ chuyển cả liên kết lịch đặt trong transaction, kiểm sức chứa và trùng lịch bàn đích. Ngừng bàn hoặc giảm sức chứa dưới số khách của lịch còn hiệu lực bị chặn. Đổi tên bàn không sửa tên snapshot của lịch cũ.

## Độ tin cậy và thông báo

- Unique `(actorId, actorType, requestId)`, hash payload và replay trước kiểm thời gian: retry giữ đúng lịch đã tạo kể cả giờ đặt đã trôi qua. Cùng key nhưng nội dung khác bị 409. Khách và counter có namespace riêng. Mất phản hồi/5xx giữ payload trong sessionStorage gắn tài khoản/portal, khóa sửa và có **Thử lại cùng yêu cầu** sau reload.
- Booking, QR, mở phiên, chuyển bàn và sửa bàn cùng ghi Table document trong Mongo transaction để ngăn tranh chỗ trên snapshot cũ; Member write lock bảo vệ trần 3 lịch và lịch cá nhân. Check-in/hủy có expectedVersion và replay trạng thái đích an toàn. Audit/outbox cùng transaction, thất bại thì rollback.
- API chính chủ/internal, CSRF, rate limiting, Cache-Control no-store và portal isolation. Availability chỉ trả id/tên/mã/sức chứa bàn, không có QR token hoặc contact. Outbox `reservation.changed` chỉ Staff/Admin và không chứa tên/SĐT; client tải lại theo quyền, có polling 10 giây.
- Staff có badge tổng lịch active, thông báo nổi + đường gọi âm khi tổng tăng sau lần tải đầu, dùng cùng nút loa/thiết lập thông báo hiện có. Badge gồm đang giữ chỗ và đã đến; không phải số bàn trống. Chưa có SMS/Telegram, thu cọc, phí no-show, lịch mở cửa hoặc giới hạn công suất theo nhân viên.
- Migration `20261021-001-reservation-indexes` chỉ tạo collection/index cho Reservation: replay, code, table/interval, owner, expiry, session unique partial. Không backfill/sửa dữ liệu nghiệp vụ cũ hoặc đổi QR.

## API

Prefix `/api/v1`, envelope `{success:true,data}`. Public dùng cookie `mc_member`, Internal JWT. MemberId/staffId và duration tùy ý trong body bị từ chối.

| Method | Đường dẫn | Nội dung |
| --- | --- | --- |
| GET | `/reservations/availability` | startsAt ISO có offset, partySize; danh sách bàn đủ chỗ/trống và khoảng 60 phút |
| GET/POST | `/reservations` | Chính chủ: danh sách hoặc tạo/replay |
| POST | `/reservations/:id/cancel` | expectedVersion, reason |
| GET | `/{staff,admin}/reservations/availability` | Tìm bàn cho counter |
| GET/POST | `/{staff,admin}/reservations` | Danh sách tất cả hoặc tạo/replay tại quầy |
| POST | `/{staff,admin}/reservations/:id/{cancel,check-in}` | Hủy hoặc check-in |

Create strict: `{requestId UUID,tableId,startsAt ISO offset,partySize 1..30,name 1..80,phone,note? 0..280}`. Danh sách có `page` (30 dòng/trang), `history=true/false` (mặc định false), `date=YYYY-MM-DD` tùy chọn lọc ngày đến theo Việt Nam. Action strict `{expectedVersion,reason?}`; hủy bắt buộc reason.

## 14 kịch bản tự test

Thử bằng dữ liệu được phép tạo giao dịch; không seed/reset DB quán.

1. Mở `/reservations` chưa đăng nhập → đăng nhập → trở về đặt bàn, không cần QR và không tự vào bàn.
2. Chọn 3 khách: chỉ bàn đang hoạt động đủ ít nhất 3 chỗ. Đổi số khách/giờ phải chọn lại bàn. Chọn bàn chưa giữ chỗ cho đến khi bấm Xác nhận.
3. Đặt một lịch: kiểm mã, tên bàn, số khách, giờ VN và kết thúc sau đúng 60 phút; chưa có phiên/đơn/thu tiền.
4. Hai tài khoản đồng thời đặt cùng bàn/giờ: một thành công, một báo bàn vừa được đặt. Thử trùng một phần khoảng thời gian và đặt tiếp đúng giờ kết thúc.
5. Tạo trùng giờ trên hai bàn bằng cùng tài khoản bị chặn; 4 lịch không trùng giờ chỉ giữ tối đa 3 active. Counter đặt cho nhiều khách không bị trần thành viên.
6. Giả lập mất phản hồi: reload vẫn có thử lại, khóa sửa, chỉ tạo một lịch. Cùng requestId đổi nội dung bị từ chối.
7. Tài khoản B không thấy/hủy lịch A. Staff bị chặn API Admin; Guest không gọi được Internal. Chuyển tài khoản không hiện pending của người trước.
8. Trước giờ hơn 15 phút không check-in; trong cửa sổ cho phép, bấm check-in hai lần vẫn một phiên. Khách quét QR tham gia phiên đó, không tạo phiên thứ hai.
9. Quá giờ hẹn 15 phút: no-show, nhả bàn, còn lịch sử. Nhân viên không check-in lịch đã hết hạn. Khách đã check-in không bị no-show hay tự đẩy khỏi bàn.
10. Hủy trước check-in kèm lý do: slot đặt lại được; không phát sinh tiền. Sau check-in không hủy bằng thao tác lịch.
11. Bàn đang phục vụ bị loại cho giờ trong 60 phút tới; bàn có lịch giữ chỗ trong 60 phút tới không tự mở bằng QR/mở thủ công/chuyển phiên khác vào.
12. Khách trước quá giờ: check-in bị chặn; sau xử lý và đóng phiên cũ, thử lại trong hạn. Đóng hóa đơn phiên đặt bàn → lịch Hoàn tất; không thay logic thanh toán.
13. Chuyển phiên đã check-in: lịch theo bàn mới, không trùng lịch và đủ chỗ. Ngừng bàn/giảm sức chứa dưới số khách của lịch active bị chặn.
14. Staff mở trước, khách đặt mới: badge/tổng và thông báo nổi cập nhật, bấm vào trang để mở quyền âm; tắt loa thì im. Kiểm trên điện thoại ngày/giờ, nút chọn bàn và bảng check-in/hủy. Lightpanda chỉ xác minh DOM/hành vi; hiển thị thực, native picker, loa và OS notification cần kiểm thiết bị thật.
