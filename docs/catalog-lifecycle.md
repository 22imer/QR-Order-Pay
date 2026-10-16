# Xóa món, xóa và ẩn danh mục

## Thao tác quản trị

- **Món → Xóa**: hộp xác nhận ghi rõ tên món. Xác nhận đặt `isArchived=true`; món biến mất khỏi menu, tìm kiếm và gợi ý AI. Mở **Món đã xóa → Khôi phục** để bán lại nếu danh mục đang hiển thị. Đơn đã gửi, khoản thu và hóa đơn giữ dữ liệu cũ, không bị xóa hay thay tổng tiền.
- **Danh mục → Ẩn/Hiện**: ẩn cả danh mục và các món bên trong khỏi menu, món nổi bật, tìm kiếm và AI. Không sửa trạng thái xóa mềm của món. Hiện lại danh mục sẽ hiện các món đang bán/chưa xóa. Giỏ cũ bị server từ chối báo giá/đặt món nếu món thuộc danh mục đã ẩn; đơn đã gửi tiếp tục phục vụ bình thường.
- **Danh mục → Xóa**: danh mục trống có thể xóa sau xác nhận. Nếu còn món, gồm món đã xóa mềm, chọn **Chuyển món sang danh mục** rồi **Chuyển món và xóa**. Toàn bộ món được chuyển sang nơi nhận và danh mục nguồn bị xóa trong một transaction. Giá, ID món/size, topping, caffeine/sữa và trạng thái xóa mềm của món giữ nguyên. Nếu nơi nhận đang ẩn, món tiếp tục không hiện cho khách. Chưa có danh mục khác thì tạo một danh mục nhận trước.
- Mỗi thao tác dành cho ADMIN, có audit và sự kiện realtime. Việc chuyển/xóa có khóa ghi cùng bản ghi danh mục với tạo/chuyển món: thao tác đồng thời được retry hoặc từ chối nếu danh mục đã bị xóa, tránh món không còn danh mục. API từ chối xóa danh mục có món khi thiếu nơi nhận, nơi nhận trùng nguồn hoặc không tồn tại.

## API và file

- `DELETE /api/v1/admin/products/:id`: xóa mềm; `PATCH` với `isArchived:false` khôi phục.
- `DELETE /api/v1/admin/categories/:id`, body tùy chọn `{ "reassignTo": "ID danh mục nhận" }`; bắt buộc khi còn món. `409 CATEGORY_NOT_EMPTY`, `422` ID sai/trùng, `404` nguồn/nhận không còn. Kết quả `data.category.movedProductCount` ghi số món đã chuyển.
- Danh sách admin categories trả `productCount`, tính cả món đã xóa mềm.
- `catalogMutationService.ts`: transaction, khóa danh mục, chuyển món, audit/outbox, xóa cache menu sau commit.
- `productRepository.ts`, `menuService.ts`, `orderPricingService.ts`, `aiService.ts`: lọc theo danh mục đang hiển thị và kiểm tra lại giỏ/cấu hình AI.
- `Categories.tsx`, `Products.tsx`: xác nhận xóa/chọn nơi nhận/khôi phục; form sửa món giữ danh mục và tùy chọn hiện có.
- `catalogLifecycle.test.ts`: API, phân quyền, lịch sử, ẩn/hiện, rollback và thao tác đồng thời trên Mongo replica set cô lập.
