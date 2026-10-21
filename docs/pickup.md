# Mang đi và đặt trước nhận tại quầy (#6)

## Phạm vi và cách sử dụng

- Khách mở trang độc lập **`/pickup`** để đặt mang đi/đặt trước. Trang có thực đơn, AI và giỏ riêng; không dùng khung quét QR, trạng thái bàn, giỏ bàn hay socket bàn. Có ba mục **Đặt món**, **Đơn của tôi** (`/pickup/orders`) và **Thành viên** (`/pickup/member`). Đăng nhập bằng SĐT + mật khẩu tại đây xong tự về form đặt món. Không cần QR hay phiên bàn. SĐT chưa được xác minh bằng OTP; thông tin người nhận có thể khác tài khoản.
- `/menu` và `/ai` là luồng tại bàn: chưa có phiên QR thì yêu cầu **Quét QR**, không tự chuyển món sang mang đi kể cả đã đăng nhập thành viên. Muốn mang đi, dùng link **Mang đi** hoặc mở thẳng `/pickup`. Trang vào bàn `/t` có link **Đặt mang đi / đặt trước**; trang mang đi có link **Tại quán** để chuyển luồng chủ động.
- Nhân viên mở `/staff/pickups`, Admin mở `/admin/pickups`, cùng mục **Mang đi & đặt trước**. Tạo tại quầy bằng tên và SĐT liên hệ; không tự gán tài khoản/điểm chỉ vì trùng SĐT. Muốn tích/đổi điểm, khách tự đặt từ tài khoản của mình.
- Chọn món trong thực đơn thật, tùy chỉnh size/đường/đá/topping, số lượng và ghi chú. Giỏ này riêng với giỏ tại bàn. Báo giá lại trước khi gửi; tổng thay đổi cần xác nhận lần nữa.
- Trang đặt món của khách dùng nền xanh phối kem/đào, ảnh món lớn và bố cục riêng. Chọn theo danh mục, **Tìm món** hoặc **Xem thêm món** (6 món/lượt). **Giỏ mang đi** nổi cố định ở cuối màn hình kể cả khi rỗng, hiện số lượng và tổng tiền. Bấm giỏ để tăng/giảm/xóa món, nhập người nhận, chọn nhận ngay/hẹn giờ và đặt đơn; **Voucher & điểm** mở khi cần. Đóng bảng giỏ hoặc chuyển tab vẫn giữ nháp theo tài khoản; gửi thành công xóa nháp. Mở giỏ không tự gửi đơn. Yêu cầu chưa rõ kết quả tự mở bảng giỏ, khóa sửa và giữ payload/requestId trong sessionStorage qua reload để thử lại an toàn. Nhân viên/Admin tiếp tục dùng form tạo tại quầy.
- Thành viên chưa vào bàn dùng AI ở chính form mang đi: bấm **Gợi ý AI**, chọn gợi ý rồi tùy chỉnh để thêm vào giỏ mang đi. Trang AI tại bàn chỉ thêm vào giỏ tại bàn. Server kiểm lại ràng buộc AI và báo giá/tồn kho trước đặt.
- Tài khoản thành viên được ghi nhớ 14 ngày trên cùng trình duyệt, dùng chung cho tại bàn và mang đi. Quét QR không đăng nhập hay tạo thành viên; rời bàn không đăng xuất thành viên. Đổi người dùng tại trang **Thành viên → Đăng xuất thành viên**.
- **Mang đi ngay** không có giờ hẹn. **Hẹn giờ nhận** phải từ 15 phút đến 7 ngày tới. Form và thời gian hiển thị dùng Việt Nam UTC+7, không phụ thuộc múi giờ máy.
- Mỗi thành viên tối đa 3 đơn mang đi đang xử lý. Nhân viên không bị giới hạn 3 đơn vì tạo cho nhiều khách. Danh sách phân trang 30 dòng, có Đang xử lý/Tất cả và nút tải lại; khách chỉ thấy đơn do tài khoản mình đặt.

## Thanh toán và pha chế

1. Đơn mới `AWAITING_PAYMENT / UNPAID`, giữ nguyên liệu ngay khi đặt. Chưa thu thì chưa pha.
2. Nhân viên bấm **Xử lý đơn**, nhập số tiền/phương thức và xác nhận đã nhận tiền thực tế. Thu từng phần được; thu đủ chuyển `PENDING / PAID`. Đơn 0đ vẫn cần xác nhận khoản thu 0đ.
3. Đơn mang đi PAID vào KDS. Đơn đặt trước chỉ vào KDS từ 15 phút trước giờ hẹn; API cũng chặn PREPARING quá sớm, kể cả gọi trực tiếp. Trang Mang đi luôn thấy đơn tương lai để thu tiền hoặc quản lý.
4. Chuỗi công đoạn dùng chung: PENDING → CONFIRMED → PREPARING → READY → SERVED. Staff thao tác trên KDS hoặc trang Mang đi; Admin dùng trang Mang đi. **Khách đã nhận** chỉ bấm khi thực sự giao; lúc này `pickup.outcome=COLLECTED`, tích điểm và chốt Bill snapshot trong cùng transaction.
5. Nhân viên xem/in hóa đơn đã chốt; khách xem hóa đơn của mình. Admin → Hóa đơn có bản snapshot mang đi để in lại. Không tạo bàn hoặc phiên bàn giả, không đóng bất kỳ phiên khách đang ngồi nào.

Thu tiền vẫn là ghi nhận sau kiểm tra thủ công, không có cổng thanh toán/chuyển khoản tự động. Cập nhật Order và expectedVersion bảo vệ hai người thu cùng đơn; idempotency bảo vệ retry. Không dùng khóa thu tiền cấp phiên bàn cho đơn mang đi vì không có phiên bàn. Các khoản thu/hoàn vẫn vào CashShift và báo cáo theo ngày giao dịch. Điều chỉnh VOID/METHOD/TRANSFER dùng quy trình quản lý khác duyệt hiện có; snapshot Bill đã chốt giữ nguyên.

## Hủy, hoàn tiền và không đến

Nhân viên nhận thông báo nổi và âm báo ngay khi có đơn mới tại bàn hoặc mang đi, kể cả chưa thu tiền. Mục **Mang đi & đặt trước** có số tổng đơn đang xử lý (cả các trang tiếp theo). Socket cập nhật ngay, polling dự phòng; lần tải đầu không báo lại lịch sử. Nút loa bật/tắt âm; trình duyệt có thể cần một lần bấm hoặc gõ phím để cho phát âm. Thông báo hệ điều hành chỉ hiện nếu đã cấp quyền.

- Khách hủy đơn của mình khi chưa pha và chưa thu bất kỳ khoản nào. Nhân viên cũng hủy được với lý do. Kho và ưu đãi được trả đúng một lần.
- Đã thu một phần/đủ tiền: nhân viên **hoàn tiền thực tế**, chọn phương thức và lý do, rồi **Đã hoàn đủ tiền & hủy**. Chỉ trước PREPARING; API xác minh toàn bộ khoản thu của đơn. Không tự chuyển tiền ngân hàng.
- **Khách không đến** do nhân viên ghi nhận sau giờ hẹn ít nhất 30 phút; mang đi ngay tính từ lúc tạo + 60 phút. Không tự chạy tác vụ no-show.
- Chưa pha và chưa thu: no-show đồng thời hủy và trả giữ kho/ưu đãi. Nếu đã thu thì cần hoàn/hủy trước, sau đó vào Tất cả/Lịch sử để ghi no-show.
- Đã pha: no-show giữ nguyên nguyên liệu đã tiêu hao và khoản thu, không coi là giao khách, không tích điểm. Order giữ công đoạn cuối để không sửa sai lịch sử pha chế, outcome NO_SHOW loại khỏi KDS và danh sách đang xử lý. Tạo Bill snapshot số tiền đã thu. Không có tự hoàn/thu lại hoặc xóa giao dịch.

## Tính nhất quán và quyền riêng tư

- Dùng chung pricing/quote ký, voucher/điểm, inventory reservation/consumption và thanh toán với đơn tại bàn. Đơn đặt trước giữ kho/điểm/lượt voucher từ lúc đặt tới khi nhận hoặc hủy, kể cả giữ đến 7 ngày; chưa có hết hạn giữ tự động.
- Đặt: đơn + giữ kho/ưu đãi + audit + outbox trong một MongoDB transaction. Giao: trạng thái + WorkActivity + tích điểm + Bill + audit + outbox cùng transaction. Lỗi một phần rollback toàn bộ.
- `requestId` UUID duy nhất theo chủ yêu cầu mang đi; retry trả đơn cũ kể cả quote hết hạn/giờ hẹn đã qua. Nội dung khác cùng requestId trả 409. Nhân viên tạo có namespace riêng với thành viên.
- Form giữ payload/requestId khi lỗi mạng/5xx, khóa sửa và cho thử lại. Yêu cầu đặt chưa rõ kết quả được giữ trong sessionStorage theo tài khoản/portal để phục hồi sau reload; xóa sau kết quả chắc chắn. Không lưu mật khẩu/token trong bản nháp.
- Staff socket phát thông báo Order chỉ chứa ID/trạng thái/version, không tên/SĐT. Khách cập nhật danh sách bằng polling 10 giây; nội bộ refetch khi có sự kiện/reconnect và polling dự phòng. API danh sách/hóa đơn/các thao tác trả no-store.
- DTO đơn tại bàn/KDS không thêm thông tin liên hệ mang đi, hash request hay khóa idempotency. Contact chỉ có trong API pickup cho chính chủ hoặc Staff/Admin. Client cache gắn tài khoản; đổi người đăng nhập không dùng danh sách/hóa đơn của người trước.

## Dữ liệu và migration

Order thêm `fulfillmentType` DINE_IN/TAKEAWAY/PICKUP và pickup contact/giờ hẹn/outcome. DINE_IN cũ mặc định tương thích, vẫn bắt buộc tableId/tableSessionId; mang đi có hai trường null. Payment cho phép tableSessionId null; Bill có pickupOrderId cho hóa đơn một đơn mang đi.

Migration `20261020-001-pickup-indexes` tạo partial unique index mới trước rồi bỏ đúng hai unique index cũ áp dụng cả null: Order `(tableSessionId,idempotencyKey)` và Bill `tableSessionId`. Unique cho phiên bàn vẫn được duy trì; thêm unique `(participantId,idempotencyKey)` cho pickup và Bill pickupOrderId, cùng index danh sách theo outcome/giờ hẹn. Không backfill/sửa/xóa document nghiệp vụ. Có lock/checksum trong migration runner, apply/rerun idempotent.

Giới hạn bản đầu: chưa có giao hàng, khung giờ/công suất nhận đơn, giới hạn giờ mở cửa, phí bao bì, SMS/Telegram, tự pha theo lịch hay tự nhắc nhận, thay đổi giờ hẹn sau đặt, hoặc đánh giá đơn mang đi. Đặt trước chưa bảo đảm công suất quầy tại giờ hẹn. Báo cáo top món và gợi ý nhân sự hiện vẫn nhóm theo thời điểm tạo đơn đã thanh toán như trước; khoản thu/hoàn theo thời điểm giao dịch.

## API

Prefix `/api/v1`. Public pickup dùng cookie `mc_member`, không nhận memberId/staffId từ body. Internal dùng JWT; `/admin` chỉ ADMIN, `/staff` STAFF/ADMIN.

| Method | Đường dẫn | Nội dung |
| --- | --- | --- |
| GET | `/pickups` | Đơn chính chủ; page=1, history=false |
| POST | `/pickups/quote`, `/pickups` | Báo giá, đặt/replay |
| POST | `/pickups/:id/cancel` | Hủy đơn chính chủ chưa thu/chưa pha |
| GET | `/pickups/:id/bill` | Snapshot hóa đơn chính chủ |
| GET | `/{staff,admin}/pickups`, `.../catalog` | Danh sách tất cả, thực đơn bán tại quầy |
| POST | `/{staff,admin}/pickups/quote`, `.../pickups` | Báo giá/đặt tại quầy |
| POST | `/{staff,admin}/pickups/:id/payments` | amount/method/expectedVersion, header Idempotency-Key |
| PATCH | `/{staff,admin}/pickups/:id/status` | status/expectedVersion |
| POST | `/{staff,admin}/pickups/:id/{cancel,no-show}` | expectedVersion/reason |
| POST | `/{staff,admin}/pickups/:id/refund` | expectedVersion/amount/method/reason/refundConfirmed=true |
| GET | `/{staff,admin}/pickups/:id/bill` | Snapshot hóa đơn, không suy lại giá hiện tại |

Quote và create nhận `{requestId,items,pickup:{fulfillmentType,name,phone,scheduledAt},voucherCode?,redeemPoints?,quoteToken?}`. Create bắt buộc quote hợp lệ; quote bỏ quoteToken. Mỗi request tối đa 50 dòng × 50 phần; server kiểm món/options/tồn và tính giá.

## 19 kịch bản tự kiểm tra

Thực hiện trên DB thử hoặc dữ liệu được phép tạo giao dịch. Không chạy seed/reset DB quán để thử.

1. Khách chưa đăng nhập vào /pickup: chỉ thấy lối đăng nhập. Đăng nhập A, tạo 1 đơn mang đi, không cần QR; B không thấy/hủy/xem hóa đơn của A.
2. Chọn size/topping/đường/đá/ghi chú; so giá báo giá với KDS và hóa đơn. Giỏ tại bàn vẫn độc lập.
3. Đặt hẹn >15 phút và <7 ngày; giờ hiển thị Việt Nam. Hẹn quá gần/quá xa hoặc thiếu giờ bị từ chối. Thử máy đặt múi giờ khác.
4. Trước thu: đơn vắng KDS. Thu một phần: giữ trạng thái chờ tiền; thu đủ mới PAID. Hai nhân viên cùng version chỉ một lần thu hợp lệ.
5. Đơn hẹn còn >15 phút không vào KDS, API chặn pha sớm. Khi vào khoảng 15 phút, KDS hiện; chuyển tới READY rồi Khách đã nhận.
6. Gửi lại đúng requestId chỉ một đơn/giữ kho/lượt voucher; thay nội dung cùng key bị 409. Mất phản hồi rồi reload có nút Thử lại cùng yêu cầu.
7. Tạo đồng thời 4 đơn từ 1 thành viên: tối đa 3 active. Hủy/nhận xong một đơn thì đặt tiếp được. Nhân viên tạo cho nhiều khách không bị trần 3.
8. Chỉ còn nguyên liệu cho 1 phần, hai tài khoản đặt cùng lúc: tối đa một đơn. Hủy chưa pha trả giữ; PREPARING trừ thực một lần.
9. Khách hủy chưa thu với lý do: trả kho/điểm/lượt; đã thu một phần thì khách không hủy được. Nhân viên hoàn đủ rồi hủy, không có khoản hoàn thứ hai khi retry.
10. Dùng voucher có/không cho kết hợp điểm; kiểm trần sau voucher. Chỉ nhận thực tế mới tích điểm. Đơn 0đ xác nhận thu 0đ và hủy trước pha được.
11. No-show quá sớm bị chặn. Quá hẹn 30 phút, đơn chưa thu bị hủy và trả giữ. Đơn đã thu/chưa pha cần hoàn trước; vào lịch sử để ghi no-show.
12. Đơn đã pha rồi không đến: kho tiêu hao giữ nguyên, không tích điểm, vắng KDS; hóa đơn vẫn ghi số đã thu, không tự hoàn.
13. Nhận xong mở hóa đơn; sửa tên/giá món không đổi snapshot. Staff có nút In, khách chỉ xem; in/Excel/điện thoại cần kiểm thiết bị thật riêng.
14. Chuyển tài khoản, reconnect, thử guest gọi internal API và thử Staff gọi Admin: không lộ dữ liệu cũ, route/phân quyền đúng. Kiểm thêm luồng QR tại bàn hiện có để phát hiện hồi quy.
15. Thành viên chưa quét QR mở `/pickup`, bấm Gợi ý AI → chọn món → tùy chỉnh → thêm: giỏ mang đi có món và giữ tên/SĐT/giờ hẹn. `/ai` và `/menu` khi chưa có phiên bàn vẫn yêu cầu QR, không tự chuyển sang pickup. Khách đã vào bàn dùng trang AI vẫn thêm vào giỏ tại bàn.
16. Mở Staff và bấm vào trang một lần để trình duyệt cho phát âm. Từ cửa sổ khách tạo đơn chưa thu: Staff có thông báo nổi, âm báo và số tại Mang đi. Thử đơn tại bàn chưa thu: có thông báo và số Bàn & phiên. Tắt loa thì không phát âm. Replay/reload không báo lại lịch sử; số Mang đi là tổng toàn bộ đơn active, không chỉ 30 dòng đầu.
17. Đăng nhập thành viên → quét QR vào bàn → mở Thành viên: giữ đúng tài khoản cũ. Rời bàn vẫn đăng nhập thành viên. Đăng xuất thành viên thì không còn quyền xem/đặt pickup chính chủ cho tới khi đăng nhập lại, còn quyền phiên bàn độc lập. Quét QR từ trình duyệt chưa đăng nhập không tạo thành viên.
18. Mở thẳng `/pickup` không qua `/t`: không hiện bàn/giỏ bàn/nút gọi nhân viên. Đăng nhập tại `/pickup/member` tự quay về đặt món; thêm món rồi qua Đơn của tôi và quay lại phải giữ nháp. Gửi thành công chuyển `/pickup/orders`. Đang có giỏ tại bàn rồi sang mang đi: hai giỏ độc lập, hẹn giờ mang đi vẫn không gắn bàn. Chuyển tài khoản không dùng nháp của người trước.
19. Sau đăng nhập, giỏ nổi hiện 0 món; mở thấy rỗng và nút Chọn món. Chọn món → số lượng/tổng tiền cập nhật; mở giỏ tăng/giảm/xóa, đóng rồi mở lại vẫn đúng. Lọc danh mục/tìm món/Xem thêm không mất giỏ. Cuộn trang vẫn thấy giỏ; trên điện thoại kiểm thẻ ảnh hai cột, bảng giỏ từ đáy, nút đóng/đặt đơn dễ thấy và không bị che. Lightpanda kiểm được DOM/hành vi; bố cục hiển thị thực tế cần kiểm bằng màn hình/thiết bị thật.
