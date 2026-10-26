# Jukebox (#3)

## Sử dụng

- Admin mở **Jukebox** (`/admin/jukebox`), thêm tên, nghệ sĩ và link video YouTube `youtube.com/watch?v=…`, `youtu.be/…`, `/shorts/…`, `/live/…`, `/embed/…` hoặc URL HTTPS trực tiếp tới file `.mp3`, `.ogg`, `.wav`, `.m4a`, `.aac` hoặc `.opus`; hỗ trợ query ký URL. Tối đa 100 bài, có sửa và tắt/mở. Danh sách ban đầu rỗng, không seed nhạc ngoài.
- Khách QR mở **Chọn nhạc** (`/jukebox`). Mỗi phiên bàn có một lựa chọn chung; mọi participant hợp lệ được đổi/hủy. Tài khoản thành viên riêng không cấp quyền vote.
- Mỗi phiên có **5 lượt**. Chỉ trừ khi bài đã được quầy chọn phát, kể cả URL lỗi hoặc quầy bỏ qua sau đó; đổi/hủy trước phát không trừ. Nhiều người cùng bàn vẫn một vote. Phiên mới có 5 lượt, chuyển bàn cùng phiên giữ lượt. CHECKOUT/CLOSED không được vote và không góp hàng đợi; không chặn thanh toán/đóng phiên.
- Xếp số bàn vote giảm dần, hòa ưu tiên thời điểm chọn sớm nhất còn hiệu lực, rồi ID bài. Vote lại đúng bài giữ thời điểm cũ. Bài tiếp theo vẫn chỉ lấy hàng đợi; nhân viên có thể chọn trực tiếp bài khác bằng Phát bài này.
- Khi chọn phát, bỏ cả lựa chọn cùng bài đang tạm CHECKOUT nhưng không trừ lượt bàn đó; mở lại bàn sẽ không đưa bài đã chọn trở lại hàng đợi.
- Staff (`/staff/jukebox`) hoặc Admin mở trang trên máy nối loa, **Bật phát trên máy này**, rồi **Bài tiếp theo**. Một user/device giữ lease 30 giây, heartbeat 10 giây/lần. Có tạm dừng/phát lại, âm lượng, next và dừng chọn phát. Hết audio tự next; hàng đợi trống dừng, có vote mới quầy bấm tiếp. Điện thoại khách không phát nhạc.
- Tại **Tự chọn bài để phát**, nhân viên bấm **Phát bài này** để mở một bài đang bật trong danh sách của quán mà không cần vote. Cần bật quyền phát trên máy trước; bài đang chọn và các nút khác khóa khi thao tác chưa rõ kết quả. Nếu bài có vote hợp lệ, các phiên OPEN đã vote bài đó dùng một lượt như khi phát từ hàng đợi; bài không vote không trừ lượt của bàn nào. Các bài khác vẫn chờ. Hết bài thủ công vẫn next theo vote, không tự chọn ngẫu nhiên từ catalog. Staff được chọn bài, Admin vẫn quản lý thêm/sửa/tắt nguồn nhạc.
- Sau khi bật phát, có thể chuyển sang KDS, Bàn & phiên hoặc chức năng khác trong cùng web; bộ điều khiển Jukebox vẫn hiện và giữ nguyên bài, vị trí nghe, âm lượng. Khung YouTube tiếp tục hiển thị ở bộ điều khiển. Đổi sang tab trình duyệt khác không chủ động dừng hoặc nhả quyền; heartbeat và cập nhật hàng đợi vẫn được duy trì.
- Đăng xuất, đóng/tải lại trang hoặc bấm Nhả thiết bị sẽ dừng và nhả quyền best effort; heartbeat lỗi hoặc hết lease cũng dừng, cần bật lại. Nếu hệ điều hành cho máy ngủ hoặc trình duyệt đóng băng tab, không bảo đảm tiếp tục phát; khi trở lại, quyền hết hạn sẽ bị kiểm tra trước khi phát tiếp. Tải lại trang/bật lại thiết bị phát bài từ đầu, không đồng bộ vị trí nghe giữa máy.
- Nguồn phải truy cập trực tiếp và codec được trình duyệt hỗ trợ. YouTube phát bằng IFrame Player API chính thức với khung video hiển thị tại máy quầy; không tải/tách âm thanh hoặc chuyển mã. Không nhận link playlist-only, trang Spotify hoặc trang web tùy ý. Video bị xóa/giới hạn/chặn nhúng có thể không phát được; chọn bài khác. Chỉ nhập nguồn quán có quyền phát. URL có thể hết hạn, redirect hoặc chặn nhúng dù đúng cú pháp; quầy thấy lỗi để thử lại/chuyển bài. Đuôi file không chứng minh nguồn phát được.

## Cơ chế

- Cookie QR + CSRF + limiter 20 mutation/phút/phiên; nội bộ JWT active/role. GET no-store, ba portal tách. CSP thêm `media-src 'self' https:`; giữ policy script/frame/connect.
- `JukeboxTrack`, singleton `JukeboxState`, `JukeboxVote` unique tableSession, `JukeboxAction` unique actor/request. Migration `20261022-003-jukebox-indexes` chỉ tạo indexes/collection mới. GET không tự ghi singleton.
- Mutation ghi singleton cùng transaction để tuần tự hóa catalog/vote/lease/next. Vote khóa phiên OPEN; next khóa những phiên có vote chống đua close/transfer. Version ballot/catalog riêng, playbackVersion riêng không xung đột do bàn khác vote.
- UUID/hash/journal cho vote/catalog/next/stop. Retry đúng payload không trừ lượt/tạo bài/chuyển bài lần nữa. Key đổi payload/version cũ trả 409. Pending vote/catalog giữ sessionStorage theo chủ thể, khóa sửa và Thử lại đúng yêu cầu. Player giữ pending trong layout, qua chuyển chức năng vẫn retry đúng payload; reload chỉ đọc trạng thái, phải bật thiết bị lại, không tự next.
- PersistentJukebox được layout Staff/Admin giữ sau lần đầu vào Jukebox, lazy-load và không tự claim. Media chỉ thay khi nguồn hoặc playbackVersion đổi, không thay theo route; Suspense của trang nội dung tách khỏi player để tải chức năng khác không gỡ trình phát. Tab nền không bị visibilitychange dừng; quay lại sau freeze kiểm deadline, không tự giành lại quyền đã mất.
- POST `/staff/jukebox/play` và `/admin/jukebox/play` dùng strict `{deviceId, requestId, playbackVersion, trackId}`. Cùng lease/JukeboxAction journal/transaction/audit/outbox và quota logic với next; chọn nguồn từ snapshot catalog bật, không nhận URL trong body. Replay đúng không phát/chuyển/trừ lượt thêm, đổi payload cùng key hoặc version cũ bị từ chối. Bài không tồn tại/đã tắt trả 404, không thay bài hiện tại.
- Bài hiện tại giữ snapshot tên/nghệ sĩ/URL. Sửa/tắt catalog không thay audio giữa bài; tắt xóa vote đang chờ không trừ lượt. Lỗi nguồn không auto skip lặp.
- Outbox `jukebox.changed` chỉ `{refresh:true}`, socket đã xác thực; polling 5 giây/reconnect. Guest không có URL/danh tính/ID bàn, phiên, device hay từng người vote. Staff không giữ lease không nhận URL hiện tại; Admin đọc catalog. “Đang phát” phản ánh sự kiện audio tại máy quầy, không suy ra từ bài được server chọn.
- Không sửa Order/Payment/Bill/giỏ/kho/voucher/người trả tiền. Lease phối hợp ứng dụng, không phải DRM: không thu hồi file đã tải hoặc ngăn phần mềm khác phát. Sleep/background/loa cần thử máy thật.
- [HTML media playback](https://html.spec.whatwg.org/multipage/media.html#dom-media-play) và [W3C Autoplay Detection](https://www.w3.org/TR/autoplay-detection/) mô tả việc phát có thể bị chặn. UI xử lý play() rejection và có nút thử lại bằng thao tác người dùng.

## Tự kiểm tra

1. Chưa QR/chỉ đăng nhập thành viên: yêu cầu vào bàn, không đọc feed/vote nhạc.
2. Admin thêm HTTPS audio thật; từ chối HTTP, YouTube thiếu/sai video ID, credentials, tên rỗng/control. Staff không sửa catalog.
3. Hai điện thoại cùng bàn chọn khác bài: cùng một lựa chọn/one vote; cùng version đồng thời chỉ một thắng, bên kia 409/refetch.
4. Nhiều bàn chọn bài: nhiều vote trước, hòa theo lượt sớm; không lộ ai/bàn nào vote.
5. Đổi/hủy không trừ lượt; phát năm bài rồi vote từ thiết bị khác cùng phiên: hết lượt.
6. Mất phản hồi/reload khi vote hoặc thêm bài: pending khóa sửa, retry không trùng; đổi payload cùng key bị chặn.
7. Hai máy quầy bật cùng lúc: một giữ quyền; máy khác không URL/next/stop/heartbeat/release hộ.
8. Next chọn đúng hàng đợi, chỉ tiêu thụ vote bài đó; double click/retry/ended cũ không next thêm.
9. Trên máy nối loa dùng audio thật: tiếng/codec/volume/pause/resume/ended tự sang bài/hết queue dừng. Vote mới lúc dừng cần bấm tiếp.
10. Autoplay bị chặn, URL lỗi/404/hết hạn: không báo đang phát, có thử lại/chuyển, không skip lặp. Thử trình duyệt thật.
11. Sửa/tắt bài khi đang phát: snapshot hiện tại giữ, vote đang chờ bài tắt bỏ miễn phí, lượt sau dùng bản mới.
12. Đang phát → chuyển KDS/Bàn & phiên/Khoản thu → nhạc giữ vị trí, bộ điều khiển vẫn có tạm dừng/âm lượng/next. Quay về Jukebox không phát lại từ đầu; tạm dừng rồi chuyển chức năng phải vẫn dừng. Đổi tab trình duyệt phải tiếp tục khi trình duyệt cho phép chạy nền. Đăng xuất/đóng/reload/ngắt mạng/hết lease phải dừng; máy khác lấy quyền khi nhả/hết hạn. Kiểm tra loa, sleep/wake và tab nền bằng trình duyệt thật.
13. CHECKOUT/đóng bàn bỏ vote khỏi queue, không chặn thu/đóng. Chuyển bàn giữ vote, phiên mới allowance mới.
14. Ba portal đúng quyền/menu, không JS exception/5xx. Kiểm tra bố cục mobile/desktop, dock cuộn và thao tác chạm.
15. Chưa có vote: Staff/Admin bật quyền → Tự chọn bài để phát → Phát bài này → current đúng bài. Chưa bật quyền/máy khác giữ quyền phải khóa. Nếu đã có vote bài đó, chỉ dùng lượt của các bàn tương ứng, không làm mất các bài khác. Thử retry mất phản hồi/version cũ/bài bị Admin tắt.

Lightpanda xác nhận DOM/hành vi; không dùng DOM làm bằng chứng bố cục, tiếng từ loa, codec hay autoplay thực tế. Ca 9–12 cần thiết bị phát thật.

## Cập nhật YouTube và cách chọn máy phát — 26/10/2026

Máy tính đang chạy web cũng phát được: mở Staff/Admin Jukebox, bấm **Bật phát trên máy này**, khi có vote bấm **Bài tiếp theo**. Âm thanh phát qua loa của chính máy mở trang, không phát từ container server. Chỉ một máy giữ quyền để tránh nhiều loa phát trùng. Tạm dừng, âm lượng, hết bài/next và nhả quyền áp dụng cho cả audio và YouTube. Từ bản PWA36, chuyển chức năng hoặc đổi tab không chủ động dừng nhạc; đóng trang/đăng xuất vẫn dừng. Link/audio cũ giữ nguyên và vẫn hoạt động.

YouTube chỉ tải API/video khi máy đã nhận quyền và đang có bài YouTube; Guest không tải iframe/nguồn nhạc. Khung phát hiển thị, tối thiểu 200×200; không che điều khiển. Có origin và Referrer-Policy strict-origin-when-cross-origin. Autoplay bị chặn sẽ hướng dẫn bấm phát; lỗi video không tự skip lặp. DOM kiểm được nhúng/đường điều khiển, chưa chứng minh tiếng từ loa/codec/quảng cáo/autoplay/ended thật; cần thiết bị thật.

Test thêm: Admin dán watch/youtu.be/shorts hợp lệ → khách vote → quầy bật và next → khung YouTube hiện đúng bài; thử pause/volume/ended/chuyển chức năng/đổi tab. Link YouTube giả host, sai ID/credentials/http bị từ chối; Spotify/trang web tùy ý không được coi là audio. Cập nhật bài không đổi snapshot đang phát; lỗi nhúng vẫn có thể chuyển bài thủ công.

Nguồn: [IFrame API](https://developers.google.com/youtube/iframe_api_reference), [tham số trình phát](https://developers.google.com/youtube/player_parameters), [Referer và yêu cầu trình phát](https://developers.google.com/youtube/terms/required-minimum-functionality).
