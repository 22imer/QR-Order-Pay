# Dữ liệu lịch sử để thử gợi ý nhân sự #11

Ngày nạp: **19/10/2026**, theo yêu cầu kiểm tra và bổ sung dữ liệu của người dùng.

## Kết quả

- Tuần đang xem bắt đầu **19/10/2026**; lịch sử lấy từ **21/09/2026 00:00 đến trước 19/10/2026 00:00**, giờ Việt Nam.
- Trước khi nạp: **18/20 đơn hợp lệ**, chưa đủ để hiện gợi ý.
- Thêm đúng **2 đơn demo 0đ**, mã `D11-20261019-01`, `D11-20261019-02`, đặt vào **13/10/2026 lúc 14:10 và 14:11**. Chúng bổ sung vào khung thứ ba 14–15 giờ đã có 3 đơn trước đó.
- Sau khi nạp: **20/20 đơn**, đủ dữ liệu, có ba gợi ý:

| Khung giờ | Tổng đơn / 4 tuần | TB đơn/giờ | Định mức | Gợi ý |
| --- | ---: | ---: | ---: | ---: |
| Thứ ba 14–15 giờ | 5 | 1,25 | 6 đơn/người/giờ | 1 người |
| Thứ tư 9–10 giờ | 3 | 0,75 | 6 đơn/người/giờ | 1 người |
| Chủ nhật 10–11 giờ | 3 | 0,75 | 6 đơn/người/giờ | 1 người |

Vào **Admin → Lịch ca & hiệu suất → Nhu cầu nhân sự → Gợi ý từ lịch sử đơn**. Chọn Dùng gợi ý rồi xem bản nháp và Lưu khi muốn áp dụng. Lần nạp này không thay cấu hình nhu cầu hay lịch làm hiện có.

## Dữ liệu được thêm và ảnh hưởng

- Dataset `workforce-history-demo-v1-20261019`.
- Một danh mục tắt, một món 0đ đã archive/ngừng bán, một bàn `DEMO-WF11` không hoạt động. Tên và ghi chú bắt đầu bằng **[DEMO #11]**, không xuất hiện trên thực đơn công khai.
- Hai đơn `SERVED/PAID`, hai phiên bàn `CLOSED`, hai khoản thu `OTHER/SUCCESS` **0đ**, hai Bill snapshot 0đ có mã `DEMO-WF11-20261019-01/02`. Mỗi đơn có đúng một khoản thu và một hóa đơn, liên kết đầy đủ.
- Đây là **dữ liệu mẫu**, không phải giao dịch thực: doanh thu tăng **0đ**. Số đơn, số lượng món mẫu và lịch sử hóa đơn/khoản thu trong các báo cáo có thể tăng tương ứng. Bảng gợi ý tính cả đơn mẫu này.
- Không có WorkActivity hay đánh giá giả; không cộng hiệu suất nhân viên. Không tác động nguyên liệu/công thức/sổ kho, điểm thành viên, voucher, QR hay ca thu ngân. Không cấp quyền khách vào bàn mẫu.
- Toàn bộ bản ghi có sẵn trong **21 collection nghiệp vụ** đã được đối chiếu hash trước/sau và giữ nguyên. Chỉ thêm bản ghi demo và audit `demo.workforceHistoryAdded` của SYSTEM.

## Bộ nạp và kiểm chứng

`scripts/setup-workforce-history-demo.mjs` dùng model đã biên dịch trong container local. Mặc định chỉ xem trước; `--apply` mới ghi. Nó kiểm lại số đơn và thêm đúng phần thiếu để đạt 20 đơn cùng ít nhất một khung có 3 mẫu, trong một transaction; không reset hoặc ghi đè dữ liệu đã có. Từ chối trùng định danh demo nhưng khác nội dung. Chạy lại sau lần nạp này đã xác nhận **0 đơn/khoản thu/hóa đơn/phiên mới**.

PowerShell, từ thư mục dự án khi stack đang chạy:

```powershell
# Chỉ xem trước
Get-Content -Raw -Encoding UTF8 scripts/setup-workforce-history-demo.mjs |
  docker exec -i maycafe-production-server-internal-a-1 node --input-type=module -

# Nạp phần còn thiếu sau khi đã có backup
Get-Content -Raw -Encoding UTF8 scripts/setup-workforce-history-demo.mjs |
  docker exec -i maycafe-production-server-internal-a-1 node --input-type=module - --apply
```

Bộ nạp tính theo tuần hiện tại, nên khi dữ liệu cũ ra khỏi cửa sổ 4 tuần, cần xem trước lại trước khi quyết định nạp thêm. Không tự chạy định kỳ.

Backup trước nạp: `.cache/maycafe-before-workforce-history-demo-20261019.archive.gz`. Báo cáo `.cache/workforce-history-demo-{preview,apply,rerun}.json`; kiểm tra trước `.cache/workforce-history-check-before.json`. Không lưu mật khẩu/token trong các báo cáo này.

Lightpanda trên web local đã xác nhận UI và API cùng trả 20 đơn, cả ba nút Dùng gợi ý dùng được, món mẫu vắng khỏi menu công khai, không JS exception/HTTP 5xx. Không lưu cấu hình/lịch trong lượt smoke; phiên Admin thử đã logout. Harness/log `.cache/workforce-history-demo-smoke-20261019.mjs`, `.cache/workforce-history-demo-smoke.log`. Đây là kiểm chứng DOM/hành vi, chưa phải kiểm chứng bố cục trực quan.
