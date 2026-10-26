# Jukebox (#3)

## Sử dụng

- Admin mở **Jukebox** (`/admin/jukebox`), thêm tên, nghệ sĩ và link video YouTube `youtube.com/watch?v=…`, `youtu.be/…`, `/shorts/…`, `/live/…`, `/embed/…` hoặc URL HTTPS trực tiếp tới file `.mp3`, `.ogg`, `.wav`, `.m4a`, `.aac` hoặc `.opus`; hỗ trợ query ký URL. Tối đa 100 bài, có sửa và tắt/mở. Danh sách ban đầu rỗng, không seed nhạc ngoài.
- Khách QR mở **Chọn nhạc** (`/jukebox`). Mỗi phiên bàn có một lựa chọn chung; mọi participant hợp lệ được đổi/hủy. Tài khoản thành viên riêng không cấp quyền vote.
- Mỗi phiên có **5 lượt**. Chỉ trừ khi bài đã được quầy chọn phát, kể cả URL lỗi hoặc quầy bỏ qua sau đó; đổi/hủy trước phát không trừ. Nhiều người cùng bàn vẫn một vote. Phiên mới có 5 lượt, chuyển bàn cùng phiên giữ lượt. CHECKOUT/CLOSED không được vote và không góp hàng đợi; không chặn thanh toán/đóng phiên.
- Xếp số bàn vote giảm dần, hòa ưu tiên thời điểm chọn sớm nhất còn hiệu lực, rồi ID bài. Vote lại đúng bài giữ thời điểm cũ. Không tự thêm bài không có vote.
- Khi chọn phát, bỏ cả lựa chọn cùng bài đang tạm CHECKOUT nhưng không trừ lượt bàn đó; mở lại bàn sẽ không đưa bài đã chọn trở lại hàng đợi.
- Staff (`/staff/jukebox`) hoặc Admin mở trang trên máy nối loa, **Bật phát trên máy này**, rồi **Bài tiếp theo**. Một user/device giữ lease 30 giây, heartbeat 10 giây/lần. Có tạm dừng/phát lại, âm lượng, next và dừng chọn phát. Hết audio tự next; hàng đợi trống dừng, có vote mới quầy bấm tiếp. Điện thoại khách không phát nhạc.
- Giữ tab quầy hiển thị. Ẩn/rời trang dừng audio và nhả quyền best effort; heartbeat lỗi hoặc hết lease dừng, cần bật lại. Phục hồi bài hiện tại phát từ đầu, không đồng bộ vị trí nghe giữa máy.
- Nguồn phải truy cập trực tiếp và codec được trình duyệt hỗ trợ. YouTube phát bằng IFrame Player API chính thức với khung video hiển thị tại máy quầy; không tải/tách âm thanh hoặc chuyển mã. Không nhận link playlist-only, trang Spotify hoặc trang web tùy ý. Video bị xóa/giới hạn/chặn nhúng có thể không phát được; chọn bài khác. Chỉ nhập nguồn quán có quyền phát. URL có thể hết hạn, redirect hoặc chặn nhúng dù đúng cú pháp; quầy thấy lỗi để thử lại/chuyển bài. Đuôi file không chứng minh nguồn phát được.

## Cơ chế

- Cookie QR + CSRF + limiter 20 mutation/phút/phiên; nội bộ JWT active/role. GET no-store, ba portal tách. CSP thêm `media-src 'self' https:`; giữ policy script/frame/connect.
- `JukeboxTrack`, singleton `JukeboxState`, `JukeboxVote` unique tableSession, `JukeboxAction` unique actor/request. Migration `20261022-003-jukebox-indexes` chỉ tạo indexes/collection mới. GET không tự ghi singleton.
- Mutation ghi singleton cùng transaction để tuần tự hóa catalog/vote/lease/next. Vote khóa phiên OPEN; next khóa những phiên có vote chống đua close/transfer. Version ballot/catalog riêng, playbackVersion riêng không xung đột do bàn khác vote.
- UUID/hash/journal cho vote/catalog/next/stop. Retry đúng payload không trừ lượt/tạo bài/chuyển bài lần nữa. Key đổi payload/version cũ trả 409. Pending vote/catalog giữ sessionStorage theo chủ thể, khóa sửa và Thử lại đúng yêu cầu. Player giữ pending trong trang; reload chỉ đọc trạng thái, phải bật thiết bị lại, không tự next.
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
12. Ẩn/rời/reload/ngắt mạng/hết lease: audio dừng; máy khác lấy quyền khi nhả/hết hạn. Bật lại phát từ đầu; kiểm tra sleep/wake/background thật.
13. CHECKOUT/đóng bàn bỏ vote khỏi queue, không chặn thu/đóng. Chuyển bàn giữ vote, phiên mới allowance mới.
14. Ba portal đúng quyền/menu, không JS exception/5xx. Kiểm tra bố cục mobile/desktop, dock cuộn và thao tác chạm.

Lightpanda xác nhận DOM/hành vi; không dùng DOM làm bằng chứng bố cục, tiếng từ loa, codec hay autoplay thực tế. Ca 9–12 cần thiết bị phát thật.

## Cập nhật YouTube và cách chọn máy phát — 26/10/2026

Máy tính đang chạy web cũng phát được: mở Staff/Admin Jukebox, bấm **Bật phát trên máy này**, khi có vote bấm **Bài tiếp theo**. Âm thanh phát qua loa của chính máy mở trang, không phát từ container server. Chỉ một máy giữ quyền để tránh nhiều loa phát trùng. Tạm dừng, âm lượng, hết bài/next, nhả quyền và ẩn/rời trang áp dụng cho cả audio và YouTube. Link/audio cũ giữ nguyên và vẫn hoạt động.

YouTube chỉ tải API/video khi máy đã nhận quyền và đang có bài YouTube; Guest không tải iframe/nguồn nhạc. Khung phát hiển thị, tối thiểu 200×200; không che điều khiển. Có origin và Referrer-Policy strict-origin-when-cross-origin. Autoplay bị chặn sẽ hướng dẫn bấm phát; lỗi video không tự skip lặp. DOM kiểm được nhúng/đường điều khiển, chưa chứng minh tiếng từ loa/codec/quảng cáo/autoplay/ended thật; cần thiết bị thật.

Test thêm: Admin dán watch/youtu.be/shorts hợp lệ → khách vote → quầy bật và next → khung YouTube hiện đúng bài; thử pause/volume/ended/ẩn trang. Link YouTube giả host, sai ID/credentials/http bị từ chối; Spotify/trang web tùy ý không được coi là audio. Cập nhật bài không đổi snapshot đang phát; lỗi nhúng vẫn có thể chuyển bài thủ công.

Nguồn: [IFrame API](https://developers.google.com/youtube/iframe_api_reference), [tham số trình phát](https://developers.google.com/youtube/player_parameters), [Referer và yêu cầu trình phát](https://developers.google.com/youtube/terms/required-minimum-functionality).
