# Voucher và thành viên theo SĐT (#5)

## Sử dụng

- Khách mở **Thành viên** (`/member`), đăng ký tên, SĐT và mật khẩu. SĐT di động Việt Nam dạng `0…` hoặc `+84…` được chuẩn hóa về cùng tài khoản. Không dùng SMS; SĐT là tên đăng nhập, không phải bằng chứng sở hữu số điện thoại.
- Đăng nhập **trước khi đặt đơn** để đơn được gắn thành viên. Không gắn lại thành viên hay cộng điểm ngược cho đơn đã đặt.
- Giỏ hàng có **Mã voucher**, **Điểm muốn đổi**, nút **Kiểm tra ưu đãi**; xem số tiền giảm và tổng cần trả trước khi đặt. Đăng nhập thành viên không thay thế quyền vào bàn qua QR.
- Admin mở **Voucher** (`/admin/vouchers`) để tạo/sửa/tạm dừng chương trình. Bật **Cho phép dùng kèm điểm** nếu muốn voucher kết hợp với điểm. Mặc định tắt, kể cả voucher cũ. Mã không đổi sau khi tạo; muốn mã khác phải tạo chương trình mới.
- Admin mở **Thành viên** (`/admin/members`) để tìm theo SĐT/tên, xem điểm/lịch sử, khóa/mở và đặt lại mật khẩu. Không có API tự sửa số dư điểm. Đặt lại mật khẩu sau khi kiểm tra yêu cầu khách tại quầy; vì không có SMS/email xác minh nên không có chức năng tự khôi phục mật khẩu qua SĐT.

## Quy tắc bản đầu

| Nội dung           | Quy tắc                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voucher            | Giảm tiền cố định hoặc %, có tiền món tối thiểu, trần giảm, thời gian bắt đầu/kết thúc, tổng lượt; tùy chọn yêu cầu thành viên và lượt mỗi thành viên |
| Kết hợp            | Được dùng voucher **và** điểm nếu admin bật **Cho phép dùng kèm điểm** trên voucher; trừ voucher trước rồi mới trừ điểm                               |
| Tích điểm          | `floor(tổng sau ưu đãi / 10.000)` khi đơn vừa PAID vừa SERVED; không tích ở bước thu tiền một phần/đủ nhưng chưa phục vụ                              |
| Đổi điểm           | 1 điểm = 1.000đ; số nguyên, tối đa 50% **số tiền còn lại sau voucher**, đồng thời không vượt số dư; trừ ngay khi đặt đơn thành công                   |
| Hủy/hoàn           | Hủy trước pha chế qua luồng hiện có trả lại điểm đã đổi và lượt voucher; đơn đã thu tiền cần ghi nhận hoàn tiền trước khi hủy                         |
| Giữ lượt           | Đơn chờ thanh toán giữ lượt voucher; nhân viên/khách cần hủy đơn bỏ dở để trả lượt, không có tự hết hạn giữ                                           |
| Giảm 100%          | Tổng có thể bằng 0đ. Nhân viên vẫn xác nhận khoản thu 0đ để đưa vào KDS; có thể ghi nhận hủy/hoàn 0đ trước pha chế                                    |
| Thành viên bị khóa | Chặn đăng nhập và đơn mới gắn tài khoản đó. Đơn đã đặt vẫn hoàn điểm/tích điểm theo snapshot để giữ đúng sổ điểm                                      |
| Lịch sử            | REDEEM, RETURN, EARN có mã đơn, biến động và số dư sau giao dịch; không hết hạn điểm ở bản đầu                                                        |

Tiền món trên từng dòng vẫn là giá trước ưu đãi. Order, hóa đơn khách, hóa đơn bàn và in lại có dòng giảm riêng; tổng thu/hoàn tính theo số tiền sau giảm. Top món trên dashboard ghi rõ tiền món **trước ưu đãi**; báo cáo thu tiền dùng khoản thu thực tế.

Ví dụ: tiền món 60.000đ, voucher giảm 10.000đ → còn 50.000đ, được đổi tối đa 25 điểm. Đổi 10 điểm giảm thêm 10.000đ → thực trả 40.000đ, tích 4 điểm khi PAID + SERVED. Voucher giảm toàn bộ còn 0đ thì không đổi thêm điểm.

## Cơ chế

- Mật khẩu bcrypt; tối thiểu 8 ký tự, tối đa 72 byte UTF-8. Không lưu mật khẩu hay token thô vào audit/response JSON.
- Cookie thành viên `mc_member`: HttpOnly, SameSite=Lax, Secure theo cấu hình hiện có; phiên tuyệt đối 14 ngày. Database chỉ lưu SHA-256 của token. Kiểm hạn ở mỗi request, không đợi TTL cleanup.
- 6 lần sai mật khẩu khóa đăng nhập tài khoản 15 phút. Endpoint đăng nhập/đăng ký/đổi mật khẩu có limiter dùng Redis hiện có; mutation khách có kiểm tra Origin/Referer.
- Đổi mật khẩu, admin đặt lại mật khẩu hoặc khóa/mở tài khoản tăng authVersion và thu hồi phiên. Admin cần expectedVersion để tránh ghi đè cập nhật đồng thời.
- Báo giá ký HMAC gắn với thiết bị, phiên bàn, món, tổng tiền, thành viên và snapshot ưu đãi. Server tính lại khi đặt; client không được quyết định memberId, discount hay số dư.
- Voucher có `allowPointRedemption`, mặc định false khi không truyền hoặc đọc voucher cũ. Quote trả `voucherAllowsPoints` và `maxRedeemPoints` để hiển thị chính sách/giới hạn. Giỏ hàng giữ nguyên cả hai lựa chọn khi bị từ chối, không âm thầm xóa mã hoặc điểm. Admin đổi quyền kết hợp sau báo giá thì phải kiểm tra lại trước khi đặt; không trừ điểm/giữ lượt khi yêu cầu thất bại.
- Trong cùng MongoDB transaction: đặt đơn, giữ kho, giữ lượt voucher, trừ điểm, ghi sổ điểm và audit/outbox. Ghi có điều kiện trên Member/Voucher ngăn tiêu trùng điểm/lượt cuối. Lỗi trước commit hoàn tác tất cả.
- VoucherUse có RESERVED/CONSUMED/RELEASED; chuẩn bị pha chế chuyển CONSUMED, hủy trước đó RELEASED. Sổ điểm unique `(orderId, type)`; replay đơn dùng cùng Idempotency-Key không tạo thêm biến động.
- Hóa đơn chốt snapshot subtotal, tổng sau giảm và các khoản giảm từng đơn. Không tính lại theo voucher đang có; không sửa hóa đơn cũ khi migration.
- Migration `20261019-002-promotions-members-indexes` chỉ thêm indexes Member, MemberSession, PointEntry, Voucher, VoucherUse. Không seed/reset dữ liệu quán.

## API

| Endpoint                                    | Quyền / nội dung                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/members/register`, `/members/login`  | Public + CSRF + limiter, trả DTO thành viên và set cookie                                                                                                     |
| GET `/members/me`                           | Thành viên hiện tại hoặc null, kèm quy tắc điểm                                                                                                               |
| POST `/members/logout`, `/members/password` | Đăng xuất / đổi mật khẩu hiện tại                                                                                                                             |
| GET `/members/points?page=1`                | Cookie thành viên hợp lệ, lịch sử của chính tài khoản đó                                                                                                      |
| GET/POST `/admin/vouchers`                  | ADMIN xem tối đa 200 chương trình mới nhất / tạo voucher                                                                                                      |
| PATCH `/admin/vouchers/:id`                 | ADMIN sửa toàn bộ cấu hình + expectedVersion                                                                                                                  |
| GET `/admin/members?q=&page=1`              | ADMIN tìm/phân trang thành viên                                                                                                                               |
| PATCH `/admin/members/:id`                  | ADMIN khóa/mở/đặt lại mật khẩu + expectedVersion                                                                                                              |
| GET `/admin/members/:id/points?page=1`      | ADMIN xem lịch sử điểm                                                                                                                                        |
| POST `/orders/quote`, `/orders`             | Thêm voucherCode và/hoặc redeemPoints theo quyền của voucher; thành viên xác định bằng cookie, vẫn cần cookie QR; `/orders` cần quoteToken và Idempotency-Key |

Schemas chính xác tại `packages/contracts/src/promotions.ts`, `schemas.ts`. Ví dụ voucher: `{code:"CAFE10", name:"Giảm 10k", type:"FIXED", value:10000, minSubtotal:50000, maxDiscount:null, startsAt:"2026-10-19T00:00:00.000Z", endsAt:"2026-12-31T16:59:59.000Z", maxUses:100, perMemberLimit:1, memberRequired:true, allowPointRedemption:true, isActive:true}`. Khi test hãy chọn thời gian đang có hiệu lực. Bản cập nhật kết hợp điểm không cần migration hoặc viết lại dữ liệu cũ.

## Kịch bản tự test

Thử trên bàn/đơn riêng; không dùng dữ liệu khách thật. Không tự chỉnh số dư để giả lập tích điểm.

1. **Đăng ký/đăng nhập:** tạo SĐT mới, đăng xuất, đăng nhập lại bằng `+84`; số dư khởi đầu 0. Đăng ký lại cùng số bị chặn. Mật khẩu sai bị báo lỗi; sai 6 lần phải đợi 15 phút.
2. **Tích điểm:** đăng nhập trước khi đặt, chọn đơn 60.000đ, thu 20.000đ rồi 40.000đ: điểm chưa đổi. Chuyển KDS tới SERVED: cộng 6 điểm và có mã đơn trong lịch sử.
3. **Voucher:** admin tạo mã giảm 10.000đ cho đơn tối thiểu 50.000đ, 1 lượt/thành viên. Đơn 60.000đ còn 50.000đ, SERVED tích 5 điểm. Chọn mã cho đơn dưới 50.000đ phải bị chặn.
4. **Đổi điểm:** dùng 5 điểm trên đơn 60.000đ: còn trả 55.000đ, trừ 5 điểm ngay khi tạo đơn. Thu đủ rồi SERVED cộng 5 điểm mới. Không cho đổi quá số dư hoặc quá 30 điểm với đơn 60.000đ.
5. **Hủy và hoàn:** đổi điểm rồi hủy khi chưa thu tiền: số dư về như trước, có RETURN. Với đơn đã thu tiền, nhân viên dùng Hủy & hoàn tiền trước pha chế; trả điểm/lượt một lần. Sau PREPARING không cho hủy theo luồng này.
6. **Lượt cuối:** tạo voucher tổng 1 lượt, hai thiết bị cùng đặt: chỉ một đơn dùng được. Hủy đơn thắng trước pha chế rồi thử lại: dùng được lượt vừa trả.
7. **Kết hợp có điều kiện:** bật **Cho phép dùng kèm điểm**, nhập mã giảm 10.000đ và đổi 10 điểm cho đơn 60.000đ: hai lựa chọn đều được giữ, tổng 40.000đ, tích 4 điểm sau phục vụ. Nếu đủ số dư, giới hạn là 25 điểm, không phải 30. Tắt tùy chọn hoặc dùng voucher cũ chưa bật: chọn cả hai bị từ chối, UI không xóa lựa chọn. Không đăng nhập không đổi được điểm và không dùng được mã yêu cầu thành viên.
8. **Hóa đơn:** đóng phiên sau khi phục vụ, đối chiếu dòng món 60.000đ − voucher 10.000đ = tổng 50.000đ. Sửa/tắt voucher rồi in lại: số tiền giữ nguyên; khách vẫn chỉ thấy đơn của thiết bị mình.
9. **Khóa/đổi mật khẩu:** admin khóa tài khoản hoặc đặt lại mật khẩu, refresh trang khách phải về đăng nhập. Đổi mật khẩu tại trang thành viên cũng đăng xuất mọi thiết bị.
10. **Giá/ưu đãi đổi sau báo giá:** kiểm tra mã rồi admin sửa giá trị; đặt đơn với báo giá cũ bị yêu cầu kiểm tra lại. Không giữ lượt/trừ điểm khi yêu cầu thất bại.
11. **Hoàn cả hai ưu đãi:** đặt đơn 60.000đ − voucher 10.000đ − 10 điểm = 40.000đ. Hủy chưa thu tiền hoặc hoàn đủ 40.000đ rồi hủy trước pha chế: trả 10 điểm và 1 lượt voucher đúng một lần. Hóa đơn đơn đã phục vụ vẫn giữ riêng cả hai dòng giảm khi in lại.

Giới hạn kiểm tra trình duyệt: Lightpanda chỉ cung cấp bằng chứng DOM/hành vi; chưa có bằng chứng CSS/layout, in giấy thật, bàn phím/camera trên điện thoại thật.
