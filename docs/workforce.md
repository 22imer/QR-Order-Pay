# Lịch ca, chấm công và hiệu suất nhân viên (#11)

## Sử dụng

- **Admin → Lịch ca & hiệu suất** (`/admin/workforce`): chọn tuần, xếp/sửa/hủy ca, xem chấm công và điều chỉnh giờ thực tế. Chỉ tài khoản đang hoạt động mới được xếp ca; chủ quán có tài khoản ADMIN cũng có thể được xếp ca.
- **Staff → Lịch & chấm công** (`/staff/workforce`): chỉ xem lịch, giờ thực tế và số liệu của chính mình; bấm **Vào ca**, **Ra ca**. Admin muốn chấm công cho mình đăng nhập portal Staff bằng tài khoản Admin. Ca đang làm luôn hiện phía trên, kể cả khi chuyển sang tuần khác.
- Tab **Hiệu suất**: số công đoạn KDS do từng người thực hiện, thời gian pha trung bình, số mẫu, sao của các đơn đã giao; lịch/thực tế, số ca vắng/trễ/chưa ra. Thẻ từng ca có số liệu KDS gắn trực tiếp với ca đó.
- Tab **Nhu cầu nhân sự**: Admin thêm khung theo thứ trong tuần, giờ bắt đầu/kết thúc và số người tối thiểu. Có thể đặt ngưỡng cao hơn cho giờ cao điểm. Chưa có cấu hình thì không suy đoán nhu cầu; lưu danh sách rỗng tắt cảnh báo.
- **Gợi ý từ lịch sử đơn** lấy 4 tuần hoàn chỉnh, ít nhất 20 đơn đã thanh toán không hủy; chỉ khung có từ 3 đơn, tối đa 12 khung. Mỗi thứ/giờ chia cho 4 lần xuất hiện (kể cả tuần không đơn), đề xuất `ceil(TB đơn/giờ ÷ định mức đơn/người/giờ)`, tối thiểu 1. Định mức mặc định 6, Admin sửa ở Cấu hình nhu cầu. Dữ liệu dừng trước tuần đang xem hoặc trước hôm nay nếu xem tương lai, không dùng ngày chưa hoàn chỉnh. Chọn **Dùng gợi ý** mở bản nháp, cần bấm **Lưu**; không tự thay quy tắc hoặc ghi đè khung chồng giờ. Đây là gợi ý theo dữ liệu, cần quản lý cân nhắc giờ mở cửa và khả năng phục vụ thực tế.
- **Đối soát ca thu ngân** ngay trong #11: ca mở/chốt trong tuần và ca đang mở, người mở/chốt, tiền dự kiến/kiểm đếm, chênh lệch và giải trình. Danh sách tối đa 50 ca, ưu tiên ca đang mở. Tổng chênh lệch lấy tất cả ca chốt trong tuần theo giờ chốt; không giới hạn theo 50 dòng đang hiển thị.
- **Sao chép lịch tuần**: chọn tuần đích cùng thứ, sau ít nhất 7 ngày → xem trước số ca, từng ca và xung đột → xác nhận. Lấy tối đa 200 ca **bắt đầu** trong tuần nguồn, bỏ ca hủy; ca đích phải ở tương lai. Có xung đột, tài khoản khóa/xóa hay nguồn thay đổi thì không tạo ca nào. Bản sao chỉ có lịch, không mang giờ chấm, điều chỉnh hay KDS cũ; tạo cả tuần trong transaction, retry không nhân đôi. Thành công tự chuyển sang tuần đích.
- **Xuất bảng công CSV** tải UTF-8 BOM mở bằng Excel, có tổng hợp tuần và chi tiết lịch/giờ bấm gốc/giờ hiệu lực/lý do điều chỉnh. Staff chỉ xuất chính mình, Admin xuất toàn bộ. Tổng hợp giờ cắt theo tuần, chi tiết là cả ca; không dùng số chi tiết cộng lại thay tổng hợp. CSV có bảo vệ chuỗi công thức từ tên/ghi chú.
- Mọi ngày/giờ nhập và hiển thị dùng **Asia/Ho_Chi_Minh (UTC+7)**, không phụ thuộc múi giờ máy người dùng. Lịch mặc định thứ hai–chủ nhật; chọn ngày khác sẽ xem 7 ngày từ ngày đó. Xếp/sửa ca ngoài khoảng đang xem tự chuyển sang ngày bắt đầu ca để thấy kết quả.
- **Tự cập nhật giữa Admin và Staff**: tạo/sửa/hủy ca, vào/ra ca, điều chỉnh giờ, lưu nhu cầu và sao chép tuần gửi thông báo realtime sau khi transaction thành công. Mỗi trang tự đọc lại dữ liệu theo quyền; không cần nhân viên bấm tải lại. Kết nối lại cũng đọc lại dữ liệu; vẫn kiểm tra mỗi 30 giây và có nút Tải lại dự phòng. Chuyển trạng thái đơn làm mới số liệu KDS.

Thông báo nội bộ `workforce.changed` chỉ có `{refresh:true}`, không chứa tên, ID nhân viên hay chi tiết lịch/chấm công; không phát cho khách. Outbox được ghi cùng transaction với nghiệp vụ/audit, retry đã thành công không phát thêm; sao chép cả tuần chỉ phát một thông báo.

## Quy tắc

| Nội dung | Bản đầu |
| --- | --- |
| Lịch | Mỗi ca >0, tối đa 16 giờ, cho phép qua đêm. Không tạo lịch đã kết thúc. Ca liền nhau được phép; cùng nhân viên không có hai ca chồng thời gian, kể cả hai quản lý thao tác đồng thời. |
| Sửa/hủy | Chỉ ca chưa vào làm; hủy cần lý do, giữ lịch sử. Ca đã vào làm khóa lịch, dùng điều chỉnh chấm công nếu giờ thực tế sai. Hủy ca nhân viên bị khóa/xóa vẫn được phép. |
| Vào ca | Chính chủ, dùng giờ server; từ 30 phút trước bắt đầu đến trước kết thúc. Không nhận giờ/SĐT/người chấm do trình duyệt cung cấp. Chỉ một ca đang làm/người, kiểm cả chồng lấn giờ thực tế. |
| Ra ca | Chính chủ, dùng giờ server, không tự chấm ra lúc hết lịch. Ca mở quá 24 giờ cần Admin điều chỉnh; tránh cộng nhiều ngày do quên ra ca. |
| Trễ/vắng | Phút trễ = số phút nguyên sau giờ bắt đầu, trừ dung sai 5 phút. Ca qua giờ bắt đầu chưa chấm: Chưa vào ca; qua giờ kết thúc vẫn chưa chấm: Vắng. Ca hủy không tính vắng. |
| Điều chỉnh | Chỉ ADMIN; đủ giờ vào/ra, lý do ≥3 ký tự; >0, tối đa 24 giờ, không ở tương lai, trong ±12 giờ quanh lịch, không trùng giờ ca khác. Có thể bổ sung cả hai giờ bị thiếu. Không sửa giờ bấm gốc, lưu before/after + người sửa trong AuditLog cùng transaction. Không có API xóa lịch/chấm công. |
| Giờ thực tế | Chỉ cộng ca đã ra hoặc được Admin chốt. Giờ cắt theo khoảng 7 ngày được chọn; ca qua ranh giới tuần không cộng hai lần. Không tính lương, giờ nghỉ, phụ cấp hoặc làm thêm trong bản đầu. |
| Thử lại | Tạo ca có requestId UUID và hash payload. Sửa/hủy/chấm công/cấu hình dùng expectedVersion; thử lại đúng yêu cầu đã thành công không ghi trùng. Mất mạng/5xx khóa sửa form, giữ nguyên payload/key để bấm Thử lại yêu cầu. Xung đột trả 409, tải lại rồi mở form mới. |
| Hiện diện | Chấm công bằng tài khoản, không có GPS/IP/Wi-Fi/sinh trắc hay xác minh có mặt tại quán. |

## Cách đọc hiệu suất và cảnh báo

`WorkActivity` được ghi **cùng transaction với chuyển trạng thái đơn, audit, outbox và kho/điểm**. Mỗi `(orderId, stage)` chỉ có một bản ghi. Không backfill/suy đoán công đoạn cho đơn cũ. Không bắt buộc vào ca để tiếp tục phục vụ khách: thao tác chưa có ca được tính **Ngoài ca**.

- **Nhận/Pha/Sẵn sàng/Giao** tương ứng CONFIRMED/PREPARING/READY/SERVED, thuộc người bấm từng công đoạn. Mỗi số là số đơn ở công đoạn đó, không cộng bốn số thành số đơn duy nhất hay số ly.
- **Pha TB**: từ PREPARING đến READY, thuộc người bắt đầu pha, ngay cả khi người khác bấm READY. Báo cáo tuần lấy mẫu theo thời điểm READY và chỉ có mẫu khi cả hai sự kiện đã được ghi từ lúc bật #11; thiếu mẫu hiện “Chưa có mẫu”.
- **Sao đơn đã giao**: điểm của đơn có Review, gắn với người bấm SERVED, luôn kèm số đơn có đánh giá. Đây là đánh giá toàn đơn, không phải điểm khách chấm riêng nhân viên; không tạo bảng xếp hạng tổng hợp.
- **KDS gắn ca** trên thẻ: dùng workShiftId lưu tại lúc bấm; thời gian pha gắn ca của người bắt đầu pha. Bao gồm toàn bộ hoạt động đã gắn với ca đó, kể cả ra ngoài khoảng tuần. Điều chỉnh giờ sau này không tự gán lại/xóa các sự kiện. Tài khoản đổi tên/xóa vẫn giữ snapshot tên và lịch sử.
- **Đã xếp X/Y**: X là số nhân viên đồng thời thấp nhất trong **toàn khung**, Y là ngưỡng cấu hình. Hai người lần lượt làm nửa khung không được tính là hai người đủ cả khung. Khoảng trống giữa ca cho kết quả 0. Người bị khóa/xóa không được tính đủ lịch.
- **Đang chấm công X/Y** chỉ hiện ở khung đang diễn ra: số tài khoản hoạt động đang WORKING, độc lập với số đã xếp. Ca quên ra vẫn giữ WORKING; cần quản lý xử lý, không coi số này là bằng chứng hiện diện thực tế.
- **Chênh lệch tiền** vẫn theo ca thu ngân, người mở/chốt và khoản thu/hoàn/đảo thực tế. Không phân bổ chênh lệch cho mọi người có lịch trùng giờ. Xem tab Đối soát ca thu ngân; #11 không đổi quy tắc thu tiền/chốt ca hiện có.

## API và dữ liệu

Prefix `/api/v1`, JWT hiện có. Guest portal chặn `/staff` và `/admin`; STAFF không truy cập API Admin. DTO không trả hash request/token/mật khẩu hoặc đưa dữ liệu nhân sự vào đơn/hóa đơn khách.

| Method | Endpoint | Nội dung |
| --- | --- | --- |
| GET | `/staff/workforce?from=YYYY-MM-DD` | Lịch/báo cáo riêng, ca đang làm dù ngoài tuần |
| POST | `/staff/workforce/:id/clock-in`, `/clock-out` | `{expectedVersion}`, chính chủ |
| GET | `/admin/workforce?from=YYYY-MM-DD` | Lịch/báo cáo toàn bộ, danh sách tài khoản có thể xếp, cấu hình và coverage |
| POST | `/admin/workforce/shifts` | `{staffId,label,startsAt,endsAt,note,requestId}`; timestamp ISO có timezone |
| PATCH | `/admin/workforce/shifts/:id` | Cùng các trường lịch, bỏ requestId, thêm expectedVersion |
| POST | `/admin/workforce/shifts/:id/cancel` | `{expectedVersion,reason}` |
| POST | `/admin/workforce/shifts/:id/attendance` | `{expectedVersion,startsAt,endsAt,reason}` giờ thực tế |
| PUT | `/admin/workforce/policy` | `{expectedVersion,rules:[{day,startMinute,endMinute,minStaff,label}]}`; day 1=thứ hai, 7=chủ nhật; phút 0–1440, khung trong cùng ngày không chồng lấn |
| POST | `/admin/workforce/copy-preview` | `{from,targetFrom}` trả lịch dự kiến, xung đột và snapshot; không ghi |
| POST | `/admin/workforce/copy` | `{from,targetFrom,snapshot,requestId}` kiểm lại và sao chép tất cả trong transaction hoặc không tạo |
| GET | `/staff/workforce/export?from=YYYY-MM-DD` | CSV riêng của người đăng nhập |
| GET | `/admin/workforce/export?from=YYYY-MM-DD` | CSV toàn bộ, chỉ Admin |

Models mới: `WorkShift` (lịch + chấm gốc/hiệu lực + version), `StaffingPolicy` (singleton cấu hình), `WorkActivity` (người/ca/công đoạn và mẫu pha). User chỉ được khóa ghi bằng version nội bộ khi chống tranh chấp, không đổi quyền/mật khẩu. Migration `20261019-003-workforce-indexes` chỉ tạo indexes; không sửa/backfill/reset dữ liệu nghiệp vụ. Cần chạy migration trước API mới trong production theo Compose gate hiện có.

Bổ sung `WorkScheduleCopy` giữ kết quả/idempotency batch, `StaffingPolicy.ordersPerStaffHour` mặc định 6 kể cả dữ liệu cũ. Migration `20261019-004-workforce-planning-indexes` chỉ tạo index lưu replay sao chép và lookup ngày CashShift, không sửa số liệu. API Admin tuần có thêm `peaks`/`cash`; Staff nhận null, không nhìn dữ liệu này. Quy tắc tính lương và xin nghỉ/đổi ca có duyệt nằm ngoài phạm vi user đã chọn cho lần hoàn thiện này.

## 18 kịch bản tự test

Thực hiện bằng dữ liệu demo do bạn chủ động chọn. Không chạy seed/reset để bắt đầu test.

1. Admin xếp ca cho nhân viên A từ bây giờ đến 1 giờ sau. Staff A thấy ca; Staff B không thấy lịch, giờ công hoặc số liệu A.
2. Xếp ca A trùng thời gian, thử từ hai cửa sổ Admin: chỉ một yêu cầu tạo được; yêu cầu còn lại báo trùng. Ca bắt đầu đúng giờ ca trước kết thúc vẫn tạo được.
3. Staff A vào ca: giờ server xuất hiện. Bấm lại/retry cùng yêu cầu không tạo lần vào thứ hai. Staff B gọi API chấm ca A bị 403.
4. Ca bắt đầu sau hơn 30 phút: Vào ca bị khóa, gọi API trực tiếp bị 409. Ca đã kết thúc hoặc đã hủy cũng không vào được.
5. Vào ca rồi đặt/thu tiền đơn test theo luồng sẵn có; Staff A nhận và bắt đầu pha. Staff B chuyển Sẵn sàng/Giao: báo cáo tách đúng người từng công đoạn, thời gian pha thuộc A; B chưa vào ca thì hai thao tác tính Ngoài ca.
6. Khách đánh giá đơn đã giao: trung bình/số mẫu hiện ở người giao. Không có đánh giá hoặc không đủ hai mốc pha thì hiện Chưa có mẫu, không hiện 0 sao hay 0 phút giả.
7. Staff ra ca: số giờ thực tế được cộng. Thử lại không thêm audit. Sửa/hủy lịch ca đã chấm bị chặn; Staff vẫn đọc được lịch sử.
8. Admin điều chỉnh ca quên chấm hoặc sai giờ: lý do bắt buộc, giờ tương lai/trùng ca khác bị chặn; sửa hợp lệ hiện người sửa/lý do/giờ gốc. Số liệu giờ công đổi, sự kiện KDS giữ nguyên ca đã gắn.
9. Hai Admin cùng sửa một ca từ version cũ: một thay đổi thành công, thay đổi khác báo cần tải lại. Ngắt mạng khi lưu, kết nối lại và dùng Thử lại yêu cầu: không tạo hai ca hoặc hai lần chấm.
10. Cấu hình khung cao điểm 07:00–09:00 cần 2 người. A làm 07:00–08:00 và 08:00–09:00: báo 1/2, thiếu 1. Thêm B đủ cả khung thì 2/2; khóa B thì báo thiếu lại. Khung đang diễn ra có thêm số đang chấm công.
11. Tạo ca qua đêm 22:00–02:00: hiện trên cả hai ngày. Chọn hai khoảng tuần liền nhau qua ca và xem giờ thực tế được cắt đúng ranh giới 00:00 Việt Nam.
12. Ca chưa chấm sau giờ kết thúc hiện Vắng; ca hủy không tính vắng. Staff đổi sang tuần khác vẫn thấy nút Ra ca nếu còn ca đang làm. Ca mở quá 24 giờ cần quản lý chốt giờ thực tế, không tự cộng nhiều ngày.
13. Chọn tuần nguồn có ca, Sao chép lịch tuần → Xem trước tuần sau. Xem từng ca và xác nhận; tự sang tuần đích, giờ công rỗng. Thử lại sau lỗi mạng không tạo hai lần. Tạo sẵn một ca trùng ở đích rồi xem trước lại: báo xung đột, không tạo một phần các ca còn lại.
14. Mở xem trước từ cửa sổ A, sửa ca nguồn ở cửa sổ B rồi xác nhận tại A: báo nguồn thay đổi, cần xem trước lại. Nhân viên thường không có nút và API sao chép trả 403.
15. Nhu cầu nhân sự: ít hơn 20 đơn trong khoảng lịch sử hiện chưa đủ dữ liệu. Khi đủ, kiểm số mẫu/4 tuần/định mức. Chọn một gợi ý chưa trùng khung → xem bản nháp → Lưu; chưa Lưu thì cấu hình không đổi. Đối soát hiển thị người mở/chốt và lý do chênh lệch từ CashShift, không gán cho người chỉ cùng giờ làm.
16. Staff xuất CSV: chỉ có bản thân; Admin xuất toàn bộ. Mở bằng Excel kiểm tiếng Việt, giờ Việt Nam, giờ gốc/hiệu lực và tổng hợp tuần. Ca qua ranh giới tuần chỉ tính phần giao tuần trong tổng hợp; ca chưa chốt không cộng giờ. Tên/ghi chú bắt đầu bằng dấu công thức được xuất dạng văn bản.

17. Mở Admin và Staff A ở hai phiên đăng nhập riêng, cùng tuần. Admin tạo/sửa/hủy ca A: cả hai trang tự cập nhật trước chu kỳ 30 giây, không bấm tải lại. Staff A vào/ra ca: Admin tự thấy trạng thái/giờ công đổi; Staff B vẫn chỉ đọc được dữ liệu mình.
18. Mất kết nối rồi có thay đổi ở phiên khác; kết nối lại trang tự lấy trạng thái mới. Admin đang xem tuần hiện tại nhưng tạo ca tuần sau: trang tự chuyển tới ca vừa tạo.

## Giới hạn kiểm chứng

Đã bổ sung dữ liệu theo yêu cầu user ngày 19/10/2026: từ 18 lên 20 đơn hợp lệ bằng 2 đơn DEMO 0đ, hiện có 3 gợi ý. Chi tiết định danh, ảnh hưởng báo cáo, bộ nạp và kiểm chứng tại [dữ liệu lịch sử demo #11](workforce-history-demo.md).

Kiểm thử tích hợp chạy MongoDB replica set tạm riêng; smoke các thao tác nghiệp vụ dùng Lightpanda trên frontend build và DB tạm. DOM/hành vi không chứng minh CSS/layout trực quan, thao tác dropdown native hoặc giao diện điện thoại thật. Bộ dữ liệu lịch sử demo ở trên là lần nạp riêng được user yêu cầu; không tạo ca/chấm công hay đặt/thu đơn thật để chạy kiểm thử tự động trên quán.
