# Bộ dữ liệu kho mẫu — Fantastic cafe

Đã nạp vào stack local ngày 19/10/2026, mã bộ dữ liệu `fantastic-inventory-demo-v1`. Gồm **32 nguyên liệu, 22 công thức món, 6 công thức topping và 32 phiếu nhập tồn đầu**. Đây là định lượng minh họa để kiểm thử BTL; cần chủ quán duyệt lại nếu dùng vận hành thực tế.

Trái cây tính phần ăn được sau sơ chế; trà/cold brew, topping và bánh là bán thành phẩm/thành phẩm. Không hạch toán nước, đá hoặc lượng đường thêm theo lựa chọn. Công thức không thay đổi theo mức đường/đá trong phiên bản hiện tại.

## Nguyên liệu và tồn đầu

| Mã              | Nguyên liệu                        | Đơn vị   | Tồn đầu | Ngưỡng sắp hết |
| --------------- | ---------------------------------- | -------- | ------: | -------------: |
| COFFEE_BEANS    | Cà phê hạt rang                    | g        |   1.000 |            100 |
| FRESH_MILK      | Sữa tươi                           | ml       |   5.000 |            500 |
| CONDENSED_MILK  | Sữa đặc                            | ml       |   2.000 |            200 |
| COCONUT_MILK    | Cốt dừa                            | ml       |   1.500 |            150 |
| COLD_BREW_BASE  | Cốt cold brew đã ủ                 | ml       |   3.000 |            300 |
| FRUIT_TEA_BASE  | Cốt trà trái cây không caffeine    | ml       |   5.000 |            500 |
| BLACK_TEA_BASE  | Cốt hồng trà đã ủ                  | ml       |   4.000 |            400 |
| PEACH           | Đào miếng                          | g        |   1.500 |            150 |
| ORANGE          | Cam tươi sơ chế                    | g        |   6.000 |            600 |
| LEMONGRASS      | Sả tươi                            | g        |     200 |             20 |
| AVOCADO         | Thịt bơ                            | g        |   2.000 |            200 |
| MANGO           | Thịt xoài                          | g        |   2.000 |            200 |
| STRAWBERRY      | Dâu tây                            | g        |   2.000 |            200 |
| YOGURT          | Sữa chua                           | g        |   3.000 |            300 |
| HONEY           | Mật ong                            | ml       |   1.000 |            100 |
| BLUEBERRY       | Việt quất                          | g        |   1.000 |            100 |
| BANANA          | Chuối bóc vỏ                       | g        |   1.500 |            150 |
| WATERMELON      | Thịt dưa hấu                       | g        |   5.000 |            500 |
| CARROT          | Cà rốt sơ chế                      | g        |   4.000 |            400 |
| GINGER          | Gừng tươi                          | g        |     300 |             30 |
| HAZELNUT_SYRUP  | Syrup hạt phỉ                      | ml       |   1.000 |            100 |
| CHOCOLATE_SAUCE | Sốt chocolate                      | ml       |   1.000 |            100 |
| BLACK_PEARL     | Trân châu đen đã nấu               | g        |   1.000 |            100 |
| WHITE_PEARL     | Trân châu trắng đã chuẩn bị        | g        |   1.000 |            100 |
| COFFEE_JELLY    | Thạch cà phê đã chuẩn bị           | g        |   1.000 |            100 |
| EGG_PUDDING     | Pudding trứng thành phẩm           | cái/phần |      20 |              3 |
| CHEESE_FOAM     | Kem cheese đã đánh                 | g        |   1.000 |            100 |
| CARAMEL_SAUCE   | Sốt caramel                        | ml       |   1.000 |            100 |
| CROISSANT_READY | Croissant thành phẩm               | cái/phần |      30 |              5 |
| TIRAMISU_READY  | Tiramisu thành phẩm (phần)         | cái/phần |      20 |              3 |
| MOUSSE_READY    | Mousse chanh dây thành phẩm (phần) | cái/phần |      20 |              3 |
| COOKIE_READY    | Cookie socola thành phẩm           | cái/phần |      50 |              5 |

Mức cảnh báo áp dụng cho **tồn thực trừ lượng đang giữ**. Tồn đầu không có lượng giữ và không có nguyên liệu sắp hết. Sau khi test đặt/pha chế, số liệu có thể khác; bộ nạp không tự reset.

## Công thức món cho một phần

Công thức nền áp dụng khi size không có công thức riêng. Công thức riêng **thay thế toàn bộ** nền, không cộng lên nền.

| Món hiện có           | Công thức nền                                                                                 | Công thức riêng theo size                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Espresso Mây          | Cà phê hạt rang: 18 g                                                                         | **S:** Cà phê hạt rang: 18 g<br>**M:** Cà phê hạt rang: 24 g<br>**L:** Cà phê hạt rang: 30 g                                                                                                                 |
| Bạc Xỉu Đá            | Cà phê hạt rang: 15 g; Sữa đặc: 40 ml; Sữa tươi: 80 ml                                        | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Cà phê Dừa            | Cà phê hạt rang: 18 g; Cốt dừa: 60 ml; Sữa đặc: 20 ml                                         | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Americano             | Cà phê hạt rang: 18 g                                                                         | **M:** Cà phê hạt rang: 18 g<br>**L:** Cà phê hạt rang: 24 g                                                                                                                                                 |
| Cappuccino            | Cà phê hạt rang: 18 g; Sữa tươi: 150 ml                                                       | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Trà Đào Cam Sả        | Cốt trà trái cây không caffeine: 180 ml; Đào miếng: 60 g; Cam tươi sơ chế: 30 g; Sả tươi: 5 g | **M:** Cốt trà trái cây không caffeine: 180 ml; Đào miếng: 60 g; Cam tươi sơ chế: 30 g; Sả tươi: 5 g<br>**L:** Cốt trà trái cây không caffeine: 240 ml; Đào miếng: 80 g; Cam tươi sơ chế: 40 g; Sả tươi: 8 g |
| Sinh tố Bơ            | Thịt bơ: 150 g; Sữa đặc: 30 ml; Sữa tươi: 60 ml                                               | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Sinh tố Xoài          | Thịt xoài: 180 g; Sữa tươi: 100 ml                                                            | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Sinh tố Dâu           | Dâu tây: 180 g; Sữa chua: 100 g; Mật ong: 15 ml                                               | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Nước ép Cam           | Cam tươi sơ chế: 400 g                                                                        | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Nước ép Dưa hấu       | Thịt dưa hấu: 350 g                                                                           | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Nước ép Cà rốt        | Cà rốt sơ chế: 250 g; Cam tươi sơ chế: 100 g; Gừng tươi: 3 g                                  | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Bánh Croissant        | Croissant thành phẩm: 1 cái/phần                                                              | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Bánh Tiramisu         | Tiramisu thành phẩm (phần): 1 cái/phần                                                        | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Bánh Mousse Chanh dây | Mousse chanh dây thành phẩm (phần): 1 cái/phần                                                | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Cold Brew Cam         | Cốt cold brew đã ủ: 180 ml; Cam tươi sơ chế: 120 g                                            | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Latte Hazelnut        | Cà phê hạt rang: 18 g; Sữa tươi: 180 ml; Syrup hạt phỉ: 15 ml                                 | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Mocha                 | Cà phê hạt rang: 18 g; Sữa tươi: 150 ml; Sốt chocolate: 25 ml                                 | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Hồng Trà Sữa          | Cốt hồng trà đã ủ: 180 ml; Sữa tươi: 100 ml; Sữa đặc: 20 ml                                   | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Smoothie Berry        | Việt quất: 60 g; Dâu tây: 80 g; Chuối bóc vỏ: 80 g; Sữa chua: 100 g; Mật ong: 10 ml           | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Bánh Cookie Socola    | Cookie socola thành phẩm: 1 cái/phần                                                          | Dùng nền cho các size hiện có                                                                                                                                                                                |
| Cà phê Sữa Đá (Hết)   | Cà phê hạt rang: 18 g; Sữa đặc: 35 ml                                                         | Dùng nền cho các size hiện có                                                                                                                                                                                |

## Công thức topping cho một phần thêm

| Topping         | Định lượng                           |
| --------------- | ------------------------------------ |
| Trân châu đen   | Trân châu đen đã nấu: 50 g           |
| Trân châu trắng | Trân châu trắng đã chuẩn bị: 50 g    |
| Thạch cà phê    | Thạch cà phê đã chuẩn bị: 50 g       |
| Pudding trứng   | Pudding trứng thành phẩm: 1 cái/phần |
| Kem cheese      | Kem cheese đã đánh: 30 g             |
| Sốt caramel     | Sốt caramel: 15 ml                   |

Giữ nguyên liên kết topping hiện tại: Bạc Xỉu Đá có Pudding trứng, Trà Đào Cam Sả có Trân châu trắng, Mocha có Kem cheese. Ba topping còn lại có công thức kho nhưng chưa liên kết vào món trong catalog hiện tại. Không tự đổi tùy chọn món.

Giữ nguyên các món đã xóa: Trà Vải Hoa Hồng, Trà Sữa Oolong và Trà Xanh Matcha Latte. Tên cũ **Cà phê Sữa Đá (Hết)** cũng được giữ nguyên: cờ bán hiện tại của món đang bật, chữ “(Hết)” là nội dung tên cũ, không phải kết quả kiểm tra tồn mới.

## Bảo toàn dữ liệu và chạy lại

Đã backup trước khi nạp tại `.cache/maycafe-before-inventory-demo-20261019.archive.gz`. Các lần ghi sử dụng API quản trị, có audit, sổ kho và realtime. Đã đối chiếu hash trước/sau của Order, Payment, Bill, Table, TableSession và Category: không đổi. Tên/giá/ảnh/tùy chọn/cờ catalog được giữ; `inventoryVersion` thay đổi khi khóa target để lưu công thức. Không tạo đơn/thu tiền thử trên dữ liệu quán.

Đã chạy lại bộ nạp: **0 nguyên liệu mới, 0 phiếu nhập mới, 0 công thức mới; 32 phiếu cũ được replay**. Đã kiểm tra báo giá đọc cho **30 cấu hình món/size/topping**: đủ tồn và giữ đúng giá. Chưa thực hiện các kịch bản giao dịch thủ công thay bạn.

Script `scripts/setup-inventory-demo.mjs` mặc định chỉ kiểm tra kế hoạch. Cần biến môi trường `INVENTORY_ADMIN_PASSWORD`, có thể đặt thêm `INVENTORY_ADMIN_EMAIL` và `INVENTORY_API_URL`; `--apply` mới ghi. Dùng cùng tài khoản để replay các key phiếu đầu. Script từ chối ghi đè công thức khác mẫu hoặc nguyên liệu trùng mã nhưng khác tên/đơn vị; không khôi phục tồn về ban đầu.

Chi tiết có thể chỉnh tại [inventory-demo.json](data/inventory-demo.json); cách kiểm tra tại [12 kịch bản test kho](inventory-test-scenarios.md).
