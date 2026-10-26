# Mini-game “Ai trả tiền?” (#2)

Khách đã quét QR mở **Vòng quay** (`/game`) trên Guest 8080. Game giải trí cho nhóm đang dùng cùng phiên bàn. Kết quả không sửa đơn, không đổi chủ đơn, không phân chia hóa đơn và không tự tạo/thu/chuyển tiền. Mọi người tự thống nhất chuyện trả tiền.

## Cách chơi

1. Nhập tên hiển thị 1–24 ký tự và bấm **Tạo vòng mới**. Người tạo tự tham gia, trở thành chủ vòng. Không lấy tên thành viên/SĐT hay đưa mọi thiết bị vào vòng tự động.
2. Các thiết bị khác của cùng phiên bàn mở `/game`, nhập tên riêng và bấm **Tham gia vòng**. Mỗi participant QR có một vị trí; nhiều tab dùng cùng cookie vẫn là cùng người chơi. Có thể cập nhật tên hoặc rời khi còn chờ. Không trùng tên sau chuẩn hóa Unicode/hoa-thường/khoảng trắng.
3. Chủ vòng có ô **Tên người chơi thêm → Thêm người chơi**, thêm từng tên cho cả nhóm trên một máy, có **Xóa <tên>** khi còn chờ. Tên này được ghi rõ Chủ vòng thêm, không giả làm thiết bị hoặc tài khoản. Tối đa 12 vị trí tổng cộng, không trùng tên; chỉ host được thêm/xóa, không xóa người tự tham gia. Retry cùng yêu cầu không thêm trùng; sau quay khóa danh sách.
4. Từ **2 tới 12 người** (thiết bị hợp lệ hoặc tên do host thêm khi host còn quyền), chủ vòng bấm **Quay nào!** hoặc chủ động bật lắc trên thiết bị hỗ trợ. Chỉ chủ vòng được quay/hủy; muốn rời, chủ vòng hủy phòng chờ.
5. Server chụp danh sách, bỏ guest đã bị thu hồi/hết hạn; tên thêm tay được tính theo quyền host và dùng `crypto.randomInt` chọn đều một vị trí. Lưu kết quả và mốc bắt đầu +500ms, quay 4.500ms. Các thiết bị đọc chung winner/start/reveal qua Socket.IO + API.
6. Tên được mở ở thời điểm reveal. Reload/reconnect giữa chừng dùng lại kết quả và tiến độ theo giờ server, không quay lại. Hết lượt, chờ thêm **5 giây** rồi bất kỳ guest trong bàn có thể tạo vòng mới. Mọi người tham gia lại từng vòng; không tự mang danh sách cũ qua.

Phòng chờ có hạn **10 phút**. API/GUI kiểm hạn theo clock server; khi mở vòng mới, phòng chờ quá hạn được đánh EXPIRED để giải phóng unique slot. Không cần scheduler hoặc xóa lịch sử bằng TTL. Trang trả vòng mới nhất và tối đa **10 vòng trước**, tên/kết quả chỉ trong đúng phiên bàn. Giới hạn **6 vòng tạo/phút/bàn** (kể cả hủy), API mutation riêng 40 request/phút/bàn; không dùng chung quota gọi món.

Guest capability còn hiệu lực biểu thị quyền tham gia, không xác nhận còn online/đang hiện diện. Khách đóng tab/mất mạng mà chưa Rời vòng và cookie chưa bị thu hồi vẫn nằm trong danh sách. Người tạo có thể hủy phòng chờ để mọi người tham gia lại; khi quay chỉ người có capability còn hợp lệ được giữ trong snapshot.

## Đồng bộ, quyền và retry

- Tạo/tham gia/đổi tên/rời/quay/hủy đều là REST có `requestId` UUID, CSRF, rate limit và `Cache-Control: no-store`; controller chỉ nhận actor từ cookie QR. Thành viên một mình, cookie receipt hoặc token Staff không cấp quyền chơi. Internal API/SPA không phục vụ `/game`.
- Create unique theo `(tableSessionId,hostParticipantId,requestId)`. Các thao tác có `expectedVersion` và journal unique `(roundId,actorParticipantId,requestId)` với hash kind/payload. Retry cùng yêu cầu trả vòng hiện tại mà không thay đổi thêm danh sách/kết quả hoặc sinh audit/outbox lần hai. Đổi payload trên key cũ trả conflict.
- Vòng và journal/audit/outbox cùng transaction. Mỗi mutation ghi lên TableSession để tuần tự hóa với đóng/chuyển phiên, rồi khóa version vòng. Hai lần quay/nhận cùng key, hoặc join tranh spin, chỉ một cập nhật được chốt. Danh sách đã quay bất biến; không hủy, đổi tên, tham gia hoặc rời sau DRAWN.
- DTO chỉ có ID vòng, ID công khai riêng của vị trí, tên do người chơi nhập, cờ `isYou/isHost/eligible`, phase/version và thời gian/kết quả. Không có participantId, guest/session token, request key/hash, thông tin thành viên hay dữ liệu tiền. `winnerId` được truyền ngay lúc bắt đầu animation để tính đích quay chung; UI mở tên khi tới `revealsAt`. Không có cơ chế cam kết kết quả bí mật trong bản giải trí này.
- Outbox `game.changed` chỉ `{refresh:true}` vào room phiên bàn, không Staff hoặc bàn khác. Client refetch khi có event/reconnect, polling 3 giây dự phòng. Animation SVG tính từ timestamp server và đích cố định, thiết bị vào muộn tự theo tiến độ; hỗ trợ reduced motion. Độ lệch mạng/clock có thể làm khung hình khác nhau đôi chút; kết quả và đích quay chung không đổi.
- Pending request trong sessionStorage gắn `tableSessionId:participantId`; reload cho **Thử lại yêu cầu**, không tự POST. Giữ nguyên payload/version/requestId và khóa sửa khi chưa rõ kết quả. Alias nháp lưu riêng theo cùng owner; không sửa giỏ bàn/mang đi.
- CHECKOUT chặn mutation mới, phòng chờ hiển thị đã dừng; lượt đã quay vẫn đọc kết quả. Game không chặn đóng phiên/thu tiền/idle sweeper. Đóng phiên thu hồi quyền như cũ; phiên mới không thấy game của nhóm trước. Chuyển bàn giữ cùng session thì cùng nhóm/vòng chơi đi theo phiên, không thay nghĩa vụ tiền.

## Lắc điện thoại

Nút **Bật lắc điện thoại** chỉ ở chủ vòng khi đủ điều kiện quay. Chỉ sau thao tác bật mới yêu cầu permission nếu browser có API, rồi nghe DeviceMotion khi trang đang hiển thị. Hai nhịp gia tốc rõ trong khoảng ngắn mới gọi cùng thao tác Quay; bỏ nhiễu, 800ms đầu, debounce 2 giây và khóa request chống gửi nhiều lần.

Tắt lắc khi quay, hết quyền quay, đổi vòng, trang bị ẩn hoặc rời trang. Permission từ chối/không hỗ trợ/mạng LAN HTTP không đủ secure context thì thông báo dùng nút Quay, không tự submit. Quyền và secure context theo [W3C Device Orientation and Motion](https://www.w3.org/TR/orientation-event/). Localhost trên PC thường không có cảm biến; dùng nút Quay để thử local. Chưa kiểm cảm biến/permission prompt/hiệu ứng animation trên điện thoại thật.

## API và lưu trữ

Prefix `/api/v1`, cookie `mc_guest`:

| Method / path | Body / kết quả |
| --- | --- |
| GET `/game` | `{current,history,serverNow,nextRoundAt,open}`. Chỉ trong phiên hiện tại |
| POST `/game` | Strict `{requestId:UUID,name}` → GameRound, tạo phòng chờ hoặc replay |
| POST `/game/:id/join` | Strict `{requestId,expectedVersion,name}`. Tham gia hoặc cập nhật tên của chính mình |
| POST `/game/:id/add-player` | Strict `{requestId,expectedVersion,name}`. Host thêm tên, không cần thiết bị thứ hai |
| POST `/game/:id/remove-player` | Strict `{requestId,expectedVersion,playerId UUID}`. Host xóa tên đã thêm |
| POST `/game/:id/leave` | Strict `{requestId,expectedVersion}`. Rời nếu không phải chủ vòng |
| POST `/game/:id/spin` | Strict `{requestId,expectedVersion}`. Chỉ chủ vòng; server tự chọn winner/roster/timestamps |
| POST `/game/:id/cancel` | Strict `{requestId,expectedVersion}`. Chủ vòng hủy phòng chờ |

Phase DTO: WAITING/SPINNING/FINISHED/CANCELLED/EXPIRED. DB status DRAWN với timestamp tính ra SPINNING/FINISHED; không cần ghi một mutation mới chỉ vì animation chạy hết. Expiry/checkout được phản ánh ngay khi đọc; không ghi thay cấu hình hoặc thông tin tài chính. Migration `20261022-002-mini-game-indexes` chỉ thêm MiniGameRound/MiniGameAction và indexes lobby/history/replay, không backfill hay reset quán.

## 14 kịch bản tự thử

Chuẩn bị hai browser profile/điện thoại độc lập cùng quét QR một bàn và một thiết bị ở bàn khác. Các ca tạo dữ liệu/đóng/chuyển phiên nên thử trên DB demo riêng.

1. **QR gate**: mở `/game` chưa QR → yêu cầu quét QR; đăng nhập thành viên một mình vẫn không chơi được. Staff/Admin `/game` và API game từ Internal trả 404.
2. **Explicit opt-in**: A nhập tên/tạo → đúng một vị trí A, chưa quay; B đọc được phòng chờ nhưng chưa nằm trong vòng. Giỏ/đơn/tiền giữ nguyên.
3. **Tên/vị trí**: B tham gia/đổi tên → vẫn một vị trí, tên mới đồng bộ A; trùng tên khác hoa-thường/khoảng trắng bị từ chối. Hai tab chung cookie không tạo hai người.
4. **Rời vòng**: B rời → A không quay được khi còn một người. Chủ vòng không có quyền rời âm thầm, dùng Hủy vòng. B tham gia lại thì A quay được.
5. **Quyền**: chỉ A thấy và dùng được quay/hủy; B hoặc bàn C gọi API vẫn bị chặn. Tên/ID người chơi không phát sang Staff hoặc bàn C.
6. **Đồng bộ quay**: A quay với >=2 người → A/B cùng kết quả/start/reveal; chọn một tên trong danh sách server đã chốt. Không có Order/Payment mới.
7. **Reload/reconnect**: B tải lại giữa lúc quay hoặc mất/kết nối socket lại → trở lại cùng kết quả/tiến độ, không POST spin. Reduced motion vẫn hiện đúng tên sau reveal.
8. **Tranh thao tác**: A bấm hai lần, hoặc hai tab cùng spin/key → chỉ một kết quả/audit/event; B join tranh A spin → một thay đổi thắng, bên thua refetch, danh sách sau spin không bị sửa.
9. **Mất phản hồi**: gửi create/join/spin không rõ kết quả → khóa sửa/hiện Thử lại; reload/thử lại đúng UUID/version/payload, không thêm người hoặc bốc kết quả khác. Đổi actor/phiên không gửi pending cũ.
10. **Hết hạn/giới hạn**: phòng chờ quá 10 phút hết hạn, tạo mới được và lịch sử giữ lại; 12 vị trí đầy chặn người thứ 13. Tạo/hủy nhanh đạt 6 vòng/phút thì phải chờ.
11. **Vòng tiếp**: chưa reveal +5 giây không tạo vòng mới; hết cooldown tạo được, chỉ host mới tự tham gia, B phải tham gia lại. Hủy phòng chờ và xem tối đa 10 vòng trước.
12. **Capability hết hạn/rời bàn**: B đã tham gia rồi rời phiên hoặc cookie hết hạn → không được chọn khi A quay. Còn <2 hợp lệ thì server không chốt winner.
13. **Đóng/chuyển**: CHECKOUT không quay/join/create mới; đóng phiên/idle-close không bị game chặn. Phiên mới không xem vòng cũ. Chuyển cùng phiên sang bàn trống thì vòng/nhóm vẫn theo phiên đó.
14. **Cảm biến/fallback**: trên HTTPS và thiết bị hỗ trợ, chủ vòng bật quyền rồi lắc; chỉ một spin. Từ chối quyền/thiếu cảm biến/LAN HTTP dùng Quay vẫn chạy. Tắt/ẩn/rời/đổi vòng thì không nghe cảm biến hay tự quay.

Bằng chứng Lightpanda là DOM/hành vi và giá trị góc SVG/timestamp; chưa chứng minh bố cục/che khuất, chất lượng chuyển động thực tế, cảm biến hoặc permission prompt trên điện thoại thật.

Cập nhật 26/10/2026: test nhanh một máy quét QR → nhập tên chủ vòng/tạo → thêm 2 tên → xóa/thêm lại → quay → reload cùng kết quả. Kiểm tên trùng/12 người/host-only/pending retry và không sửa danh sách sau quay. Luồng nhiều thiết bị ở trên tiếp tục được hỗ trợ.
