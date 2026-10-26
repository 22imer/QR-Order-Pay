# Smart Insights và gợi ý bán kèm (#12)

Admin mở **Smart Insights** (`/admin/insights`); khách thấy **Khách thường gọi kèm** trong giỏ tại bàn hoặc giỏ mang đi khi đủ dữ liệu. Bản đầu dùng thống kê và quy tắc có ngưỡng, không gọi LLM hay tự thay đổi đơn, giá, nhân sự hoặc tồn kho.

## Phân tích cho Admin

- Mặc định 30 ngày đã kết thúc, đến hôm qua theo giờ Việt Nam. Chọn kỳ từ 1 đến 93 ngày và kênh: tất cả, tại bàn, mang đi ngay hoặc đặt trước; bấm **Xem phân tích**. Trang tự làm mới mỗi phút.
- Chỉ lấy đơn `SERVED` + `PAID`, loại no-show; đơn chưa phục vụ, chưa trả đủ, hủy hoặc hoàn không tham gia. Ngày/giờ tính theo **thời điểm tạo đơn**, múi giờ Việt Nam; pre-order cũng dùng giờ tạo, không phải giờ nhận. Đây là phân tích đơn bán, tiền thu/hoàn theo thời điểm giao dịch vẫn xem ở Dashboard.
- Thống kê số đơn, số phần, giá trị đơn sau ưu đãi, trung bình/đơn; biểu đồ tổng số đơn theo 24 giờ; top 10 món theo số phần. Giá trị từng dòng trước voucher/đổi điểm cấp đơn, không cộng chung với tổng sau ưu đãi. Tên món theo snapshot bán gần nhất trong mẫu, gồm Freestyle và món đã ngừng bán trong lịch sử.
- Lời khuyên về giờ đông/món bán nhiều cần ít nhất 20 đơn trên 3 ngày, khung giờ/món được nhắc cần ít nhất 5 đơn. Không tự đặt lịch ca hoặc gọi đây là dự báo. So sánh số đơn với kỳ liền trước cùng độ dài chỉ khi cả hai kỳ đã kết thúc, mỗi kỳ ít nhất 20 đơn và không bị giới hạn mẫu. Có thể chọn kỳ chứa hôm nay để xem, nhưng không kết luận tăng/giảm từ ngày chưa hết.
- Mỗi kỳ tối đa **2.000 đơn mới nhất**, sắp theo thời gian tạo rồi ID, query có timeout 5 giây. Nếu vượt ngưỡng, UI nói rõ mẫu bị giới hạn, tắt so sánh và kết luận cặp món; thu hẹp kỳ để xem đầy đủ. Không trình bày mẫu giới hạn là toàn bộ doanh thu quán.

## Giá vốn và lãi gộp nguyên liệu dự kiến

Vào **Kho & công thức → Sửa nguyên liệu → Giá vốn**. Nhập VND cho **một đơn vị cơ sở** g/ml/cái, tối đa 3 số lẻ, 0..10.000.000đ; ví dụ 100.000đ/kg tương ứng 100đ/g. Giá một bao/gói cần tự quy đổi. Để trống = chưa biết; nhập 0 = xác nhận miễn phí. Tồn và đơn vị không đổi vì sửa giá vốn. API cũ bỏ qua trường này vẫn giữ giá vốn đã lưu; gửi null để xóa về chưa biết. Lưu có version và audit như các sửa nguyên liệu khác.

Bảng **Lãi gộp nguyên liệu dự kiến / cốc** sử dụng giá bán, size, công thức và giá vốn **hiện tại**, độc lập bộ lọc kỳ lịch sử. Cộng `định lượng × giá vốn` theo đơn vị cơ sở, chọn đúng công thức size (hoặc nền), rồi trừ khỏi giá hiện tại. Hiện tối đa 50 cấu hình món thường đang bán, xếp chênh lệch cao trước; hiển thị số cấu hình đủ/tổng. Giá vốn thiếu, công thức chưa bật, nguyên liệu mất/ngừng dùng hoặc phép tính quá lớn thì chi phí/lãi để trống; không mặc định bằng 0. Lãi âm vẫn hiện đúng, giá bán 0 không chia tỷ lệ phần trăm.

Đây **không phải lợi nhuận lịch sử hay lợi nhuận ròng**: chưa gồm topping, ưu đãi, bao bì ngoài công thức, hao hụt, lương, thuê mặt bằng và chi phí khác. Không gán giá vốn mới cho đơn cũ, không sửa Order/Payment/Bill/snapshot, không backfill giá vốn. Freestyle vẫn có thống kê bán nhưng không nằm trong bảng giá vốn cấu hình menu này. Muốn tính lãi lịch sử chính xác cần bổ sung chính sách chi phí và snapshot tại thời điểm bán trong một đợt riêng.

## Cặp món và gợi ý cho khách

Một đơn là một giỏ; nhiều size/dòng/số lượng cùng product chỉ tính một lần trong tần suất cặp. Giỏ chỉ Freestyle không tham gia; Freestyle không dùng làm neo hoặc món gợi ý. Giỏ hơn 12 product khác nhau không tính cặp để giới hạn chi phí xử lý, số giỏ bỏ qua hiện trên Admin. Các thống kê số đơn/số phần vẫn giữ.

Một cặp chỉ đạt ngưỡng khi có ít nhất 20 giỏ món thường, mỗi món trong ít nhất 10 giỏ, cặp trong ít nhất 5 giỏ, và **lift ≥ 1,05**. Confidence A→B = số giỏ chứa cặp / số giỏ chứa A; chiều ngược được ghi riêng. Lift = tần suất cặp / tích tần suất từng món. Tương quan không chứng minh việc giới thiệu kèm sẽ tạo thêm doanh thu.

Khách dùng **30 ngày đã kết thúc**; tại bàn chỉ học từ đơn tại bàn, mang đi học chung takeaway/pickup. Ngoài ngưỡng cặp, chiều gợi ý cần confidence thực ≥20%. Xếp theo confidence×lift, lấy điểm cao nhất từ các món neo trong giỏ, không cộng lặp để phóng đại; hòa theo product ID. Tối đa 3 món, loại món đã có. Dùng tối đa 10 product thường đầu theo ID làm neo. Thiếu dữ liệu, mẫu hơn 2.000 đơn, hoặc không còn món hợp lệ thì ẩn mục gợi ý, không bịa fallback.

Đồ thị tần suất được cache Redis 60 giây, không chứa danh tính/token, có thể chậm cập nhật đơn hoàn/hủy tối đa một phút. Catalog, danh mục, availability, size hợp lệ, tồn theo công thức và giá được đọc lại mỗi lần API; UI tải catalog mới khi bấm Chọn, mở modal size/đường/đá/topping để khách tự xác nhận. Báo giá/tạo đơn tiếp tục kiểm ở server. Không tự thêm món, không tự áp combo/giảm giá, không thay giỏ tại bàn thành giỏ mang đi. Checkout/pending khóa nút; response về muộn khi khóa/rời trang không mở modal hoặc thêm món.

API khách chỉ trả productId/tên/ảnh/giá từ hiện tại; không trả số mẫu, confidence, doanh số, chi phí, order ID hay thông tin khách. Đây là API đọc catalog công khai, không cần QR/member để xem; thao tác đặt món giữ quyền QR/member sẵn có. Internal API và SPA vẫn cách ly theo ba cổng.

## API và vận hành

| Prefix `/api/v1` | Nội dung |
| --- | --- |
| `GET /admin/insights?from=YYYY-MM-DD&to=YYYY-MM-DD&channel=ALL` | JWT ADMIN, limiter30/phút/IP, no-store; sample/summary/comparison/hours/topProducts/pairs/current margins/advice |
| `GET /recommendations/companions?context=TABLE&productIds=id1,id2` | TABLE/PICKUP, 1–10 ID24hex, limiter menu search120/phút/IP, no-store; items tối đa3 |
| `POST /admin/inventory/ingredients`, `PATCH /admin/inventory/ingredients/:id` | `unitCost` optional number/null trong schema cũ; quyền ADMIN, expectedVersion khi sửa |

Migration `20261023-003-smart-insights-index` thêm compound index Order `(status,paymentStatus,createdAt,_id)`, không backfill. Ingredient.unitCost optional không default ghi dữ liệu. Không có collection nghiệp vụ mới, không seed giá vốn hay giao dịch trên dữ liệu quán. API thống kê chỉ đọc MongoDB; Redis cache là dữ liệu suy ra.

## Nghiệm thu

1. Admin mở Insights được; Staff/Guest không đọc được chi phí/báo cáo, ba portal cách ly. API khách chỉ có dữ liệu catalog, không thông tin cá nhân/số bán/giá vốn.
2. Kỳ không có đơn hoặc ít mẫu: hiện rỗng/thiếu dữ liệu, không cặp giả, không gọi chênh lệch giá bán là lợi nhuận.
3. Đơn phục vụ+paid được tính; unpaid/pending/cancel/refund/no-show bị loại. Nhiều cốc/dòng/size không nhân số lần cặp. Freestyle tính bán, không tính cặp.
4. Kiểm ranh giới nửa đêm VN, giờ tạo pre-order, kênh và kỳ trước cùng độ dài; kỳ chứa hôm nay không có tăng/giảm.
5. Dữ liệu đủ cặp: kiểm mẫu/confidence hai chiều/lift, cặp phổ biến ngẫu nhiên lift1 không đạt; giỏ >12 món bỏ cặp có nhãn. Hơn2.000 đơn: nhãn mẫu giới hạn và tắt so sánh/cặp/gợi ý khách.
6. Nhập giá vốn theo g/ml/cái, lẻ3số; 0 khác null; thiếu một nguyên liệu không tính một phần thành tổng. Công thức size riêng tính đúng; âm hiển thị, giá bán0 không lỗi chia.
7. Đổi giá vốn/giá bán/công thức: bảng dự kiến hiện tại đổi, đơn/tiền/kho lịch sử không bị viết lại; sửa cùng version cũ bị chặn; Staff không sửa giá vốn.
8. QR giỏ có A, có cặp B đạt ngưỡng: thấy B, bấm chọn mới mở modal, chọn tùy chỉnh rồi xác nhận mới thêm; giá quote server đúng. Món đã có không gợi ý lại.
9. Member mang đi có giỏ riêng; có cả cookie QR/member vẫn thêm/đặt đúng giỏ; không tạo phiên bàn giả cho pickup.
10. Hết nguyên liệu, ngừng bán món/danh mục/size, đổi giá sau thống kê: API/selection/quote kiểm lại. Khóa checkout, đổi chủ phiên/tài khoản hoặc rời trang lúc response chậm không thêm nhầm.
11. Mất kết nối báo cáo cho retry; lỗi gợi ý không cản đặt món thường. Đọc báo cáo/cặp không tạo đơn hoặc thu tiền.
12. Kiểm trực quan trên điện thoại và máy quầy: bảng cuộn, biểu đồ giờ/nhãn, modal lồng giỏ mang đi và nút thêm/đặt không bị che. Lightpanda kiểm DOM/hành vi, chưa chứng minh bố cục/thiết bị thật.
