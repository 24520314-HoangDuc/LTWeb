# LTWeb

LTWeb là một project thực hành frontend đơn giản, mô phỏng luồng bài viết ngắn (mini social feed) để minh họa UI/UX cơ bản và kịch bản backend phục vụ dữ liệu.

## UI/UX (tóm tắt)

- Mục tiêu: cung cấp trải nghiệm xem luồng bài viết nhanh, rõ ràng và dễ tương tác trên trình duyệt.
- Giao diện chính: danh sách bài viết theo thứ tự thời gian (mới nhất trên cùng), mỗi bài hiển thị tên tác giả, nội dung tóm tắt, và thời gian đăng.
- Tương tác cơ bản: cuộn để xem thêm, nút 'Xem chi tiết' cho bài viết đầy đủ, và biểu tượng hành động (like/comment) trong giao diện mẫu.
- Thiết kế: responsive, tối giản, ưu tiên khả năng đọc; tương thích với desktop và mobile.

## Backend (chi tiết)

- File server chính: `backend.js` — một server Node.js (thường dùng Express) chịu trách nhiệm:
	- Phục vụ tệp tĩnh front-end (`Twit.html`, `Twit.js`, `Twit.css`).
	- Cung cấp API REST cơ bản cho dữ liệu bài viết.

- API endpoints (ví dụ):
	- `GET /api/posts` — trả về danh sách bài viết (hỗ trợ phân trang bằng `?page=` và `?limit=`).
	- `GET /api/posts/:id` — trả về chi tiết một bài viết.
	- `POST /api/posts` — tạo bài viết mới (thân yêu cầu JSON, gồm các trường như `author`, `content`, `createdAt`).

- Dữ liệu mẫu và seeding:
	- Thư mục `seed/` chứa `sample-posts.json` và `sample-posts-extended.json` cùng script seed để nạp dữ liệu mẫu vào server hoặc DB.
	- Khi chạy ở môi trường phát triển, server có thể đọc trực tiếp từ các file JSON hoặc nạp vào một collection tạm thời.

- Kiến trúc lưu trữ / kết nối DB:
	- Mặc định có thể dùng lưu trữ tạm thời (in-memory hoặc file JSON) cho demo. Khi cấu hình MongoDB, server đọc biến môi trường `MONGODB_URI` để kết nối.
	- Sử dụng `MongoClient` với kết nối tái sử dụng (connection pooling) và thời gian chờ hợp lý.
	- Tên collection gợi ý: `posts`.

- Định dạng bản ghi (ví dụ):
	- `_id` (ObjectId) hoặc `id` (string)
	- `author`: { `id`, `name` }
	- `content`: string
	- `createdAt`: ISO timestamp
	- `meta`: { `likes`: number, `comments`: number }

- Xử lý yêu cầu và an toàn:
	- Validate đầu vào trên server cho `POST /api/posts` (độ dài nội dung, ký tự hợp lệ).
	- Tránh injection bằng cách dùng driver/ORM chính thức và không ghép chuỗi truy vấn trực tiếp.
	- Quản lý lỗi kết nối DB: retry ngắn, fallback về chế độ đọc file tĩnh nếu không kết nối được (để demo không bị chết hoàn toàn).

- Hoạt động và triển khai:
	- Chạy server local: `node backend.js` (hoặc `npm start` nếu `package.json` có script tương ứng). Nếu kết nối tới MongoDB, export `MONGODB_URI` trước khi chạy.

## Các tệp liên quan
- [Twit.html](Twit.html) — giao diện chính.
- [Twit.js](Twit.js) — logic client.
- [Twit.css](Twit.css) — style.
- [backend.js](backend.js) — server ví dụ.
- [seed/](seed/) — dữ liệu mẫu và script seed.

