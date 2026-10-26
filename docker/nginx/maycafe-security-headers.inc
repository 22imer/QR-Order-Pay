# Header bảo mật cho trang SPA. Chỉ include trong location phục vụ file tĩnh: response API đã có
# header từ helmet. Lưu ý: add_header trong một location thay thế toàn bộ add_header kế thừa,
# nên location nào tự khai báo add_header đều phải include lại file này.
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "camera=(self), microphone=(), geolocation=(), payment=()" always;
# img-src cho phép mọi ảnh https vì admin nhập URL ảnh món từ bất kỳ nguồn nào (chưa có upload).
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' https:; connect-src 'self' ws://$http_host wss://$http_host; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
