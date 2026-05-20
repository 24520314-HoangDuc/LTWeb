# LTWeb

Ghi chú rà soát nhanh cho repo này, tập trung vào luồng chạy và các rủi ro khi kết nối MongoDB.

## Tài liệu thiết kế hệ thống, thiết kế cơ sở dữ liệu và so sánh Fanout-on-write vs Fanout-on-read

- link drive: https://drive.google.com/drive/folders/1LdVqDMcT0waUSLTw5qgHXtXvtSuOMZ0N?usp=drive_link

## Luồng hiện tại

- Frontend gọi API tại `http://localhost:3000/api`.
- Backend đọc `DB_CONNECTION_STRING` từ `.env`, nếu thiếu thì fallback sang chuỗi mẫu trong `backend.js`.
- `mongoose.connect()` đang dùng `serverSelectionTimeoutMS: 5000`, nên lỗi mạng hoặc Atlas chậm phản hồi sẽ lộ ra khá nhanh.

## Các lỗi tiềm năng liên quan đến MongoDB

1. IP Access List của Atlas chưa cho phép IP hiện tại.
- Dấu hiệu: backend báo `MongoDB connection error` với lỗi kiểu `not authorized`, `IP not allowed`, hoặc timeout.
- Cần kiểm tra: `Security > Network Access` trong Atlas, thêm đúng IP public đang dùng hoặc tạm mở `0.0.0.0/0` để test.

2. Sai cluster, sai project, hoặc sai replica set trong chuỗi kết nối.
- Dấu hiệu: DNS resolve được nhưng `server selection timed out`, `ReplicaSetNoPrimary`, hoặc không tìm thấy host.
- Cần kiểm tra: hostname trong `.env` có đúng cluster hiện tại không, và nếu dùng URI nhiều host thì `replicaSet` phải khớp với cluster.

3. Sai username/password hoặc user chưa có quyền vào database.
- Dấu hiệu: `Authentication failed`, `bad auth`, hoặc kết nối được nhưng truy vấn bị từ chối.
- Cần kiểm tra: `Database Access` trong Atlas, quyền của user, và các ký tự đặc biệt trong password có được encode đúng chưa.

4. Dùng nhầm file chứa chuỗi kết nối.
- Hiện chuỗi kết nối đang xuất hiện trong `.env`, nhưng file `.gitignore` lại đang chứa một biến `MONGODB_URI` thật.
- Dấu hiệu: khi chỉnh môi trường mà backend vẫn lấy cấu hình cũ, hoặc người khác mở repo thấy secret lộ ra.
- Cần kiểm tra: chỉ giữ secret ở `.env`, còn `.gitignore` nên là danh sách file/folder cần bỏ qua.

5. DNS/SRV hoặc mạng cục bộ chặn kết nối ra ngoài.
- Dấu hiệu: lỗi kiểu `ENOTFOUND`, `getaddrinfo`, hoặc timeout dù IP đã allow.
- Cần kiểm tra: DNS của máy, VPN/proxy, firewall, và thử chạy lại bằng URI SRV lẫn URI nhiều host.

6. Thời gian chờ quá ngắn so với mạng thực tế.
- Dấu hiệu: lúc thì connect được, lúc thì fail ngẫu nhiên.
- Cần kiểm tra: thử tăng `serverSelectionTimeoutMS` tạm thời để phân biệt lỗi mạng chậm với lỗi cấu hình thật.

## Checklist debug nhanh

- Xác nhận backend đang đọc đúng `DB_CONNECTION_STRING` trong `.env`.
- Xác nhận IP public hiện tại đã được allow trong Atlas.
- Xác nhận user DB đúng mật khẩu và đúng quyền.
- Xác nhận cluster/replica set trùng với URI.
- Xác nhận máy không bị VPN, proxy, hoặc firewall chặn ra ngoài.

## Ghi chú thêm

- Nếu backend vẫn không connect, log lỗi đầy đủ của `mongoose.connect()` sẽ quyết định nguyên nhân chính xác hơn log rút gọn.
- Khi debug mạng, nên test theo thứ tự: DNS -> auth -> IP allowlist -> replica set -> timeout.
