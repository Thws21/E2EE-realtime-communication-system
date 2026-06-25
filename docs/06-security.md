# 06 - Baseline Bảo Mật

## Mục tiêu

Thiết lập baseline bảo mật đúng và đủ cho hệ thống có triển khai thực tế: định danh, xác thực, bảo vệ dữ liệu, và chống lạm dụng.

## Định danh và ID

- Mọi ID public (`userId`, `conversationId`, `messageId`, `requestId`, `sessionId`, `deviceId`, `callId`, …): **UUID v7** (RFC 9562). Chi tiết: [`00-glossary-and-naming.md`](00-glossary-and-naming.md).
- Request/Event ID: UUID v7 cho traceability và idempotency.

Quy tắc:
- ID phải bất biến sau khi tạo.
- ID không được mã hóa thông tin riêng tư.
- Không dùng integer sequential làm public identifier.

## Thông tin xác thực và mật khẩu

- Password hash algorithm: `scrypt` (Node.js built-in `crypto.scryptSync`, N=16384, r=8, p=1, keyLen=64 bytes). Salt: 16 random bytes. Stored as `scrypt:<salt>:<hash>` (base64url).
- Never store plaintext password.
- Enforce password policy:
  - min 8 chars.

## JWT và phiên đăng nhập

- Access token lifetime: 15 minutes.
- Refresh token lifetime: 30 ngày (mặc định; cấu hình qua `REFRESH_TOKEN_TTL_SEC`).
- Refresh token rotation: enabled.
- Reuse detection: revoke session chain on replay.
- Refresh token chỉ lưu dưới dạng băm trong kho phiên.
- Source of truth cho session và refresh token hash là PostgreSQL.

Baseline claim:
```txt
sub: string(uuid-v7) [required]
sid: string(uuid-v7) [required]
deviceId: string(uuid-v7) [required]
iat: number [required]
exp: number [required]
```

Issuer: **API Service**. Trên wire, claim phiên là `sid` (không alias `sessionId` trong JWT payload).

## Bảo mật OTP (đăng ký qua email)

- OTP length: 6 digits.
- OTP expiry: 10 minutes (code: `NOW() + INTERVAL '10 minutes'`).
- Max attempts: 5.
- OTP gửi qua email bằng SMTP (Nodemailer). SMTP bắt buộc cấu hình đủ 5 biến: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — thiếu → endpoint trả 503.
- OTP code dùng `crypto.randomInt` (CSPRNG). Hash bằng `scrypt` trước khi lưu DB.
- Trong `NODE_ENV=development`, response còn trả thêm `otpCode` để test không cần mailbox thật (chỉ khi email đã gửi thành công).
- Source of truth cho OTP records là PostgreSQL.

## Redis policy (v1)

- Redis không là nguồn dữ liệu chuẩn cho OTP/session/token ở v1.
- `api-service` hiện không dùng Redis.
- Redis chỉ dành cho dữ liệu tạm ở các service cần cache/pub-sub khi scale.
- Nếu Redis bị mất dữ liệu, hệ thống vẫn khôi phục được trạng thái nghiệp vụ chính từ PostgreSQL.

## Quyền riêng tư khi tìm người dùng

- Public search trả về:
  - `username`, `displayName`, `avatarUrl`.
- Public search không được trả email raw.
- Exact email search may be allowed but response remains masked/minimal.

## Socket authentication (handshake-only)

Policy SYS-03 — chi tiết triển khai khớp [`03-events.md`](03-events.md) và Realtime `socket/auth`.

| Quy tắc | Chi tiết |
|---------|----------|
| Thời điểm auth | Chỉ tại Socket.IO handshake; payload event **không** mang token |
| Client field | `socket.handshake.auth.accessToken` (canonical) |
| JWT | HS256; claims `sub`, `sid`, `deviceId`, `exp` — khớp JWT baseline ở trên |
| Server context | `userId` ← `sub`; `deviceId`, `sessionId` ← claims; `senderUserId` server-derived |
| Test-only | `Authorization: Bearer` header — chỉ tooling/script, không dùng production FE |
| Dev token | `dev:<userId>:<deviceId>:<sessionId>` — **chỉ** khi `NODE_ENV !== production` |
| Production | Cấm dev token; thiếu `JWT_ACCESS_SECRET` → từ chối handshake |
| Lỗi | `AUTH_INVALID`, `AUTH_TOKEN_EXPIRED` — không leak chi tiết JWT |

Quy tắc bổ sung:

- `JWT_ACCESS_SECRET` phải **khớp** giữa API Service và Realtime Service.
- Dev bypass `ALLOW_DEV_MESSAGE_PERSIST` chỉ bật local; staging/prod phải tắt. (`ALLOW_DEV_CONVERSATION_ACCESS` đã bị xóa — membership check hiện dùng HTTP thật tới API internal.)
- Không log access token, dev token, hoặc JWT payload trong log thường.

## Bảo mật đường truyền

- Chỉ dùng HTTPS ở môi trường không phải local.
- Secure websocket (`wss`) in non-local environments.
- CORS allowlist for known frontend origins.
- Internal API giữa Realtime và API phải có xác thực service-to-service (ví dụ: mTLS hoặc service token xoay vòng).

## Logging và secrets

- Bắt buộc che:
  - email local-part.
  - tokens.
  - OTP.
- Không được log:
  - message plaintext.
  - derived symmetric keys.
  - raw password.

## Chính sách lưu trữ và hủy dữ liệu

- OTP records:
  - giữ tối đa 7 ngày để audit, sau đó xóa mềm hoặc xóa cứng theo chính sách vận hành.
- Session/revocation records:
  - giữ tối thiểu bằng thời gian sống refresh token + 7 ngày.
- Message ciphertext:
  - giữ theo yêu cầu sản phẩm; không tự động xóa ở v1 nếu chưa có policy nghiệp vụ.
- Security logs:
  - giữ tối thiểu 30 ngày.

## Chống lạm dụng

### Giới hạn tần suất (Rate Limiting)

### Mã hóa mật khẩu (Password Hashing)

Mật khẩu và OTP được băm bằng `crypto.scryptSync()` trong `api-service/src/security.ts`; code hiện tại không dùng bcrypt.

**Cấu hình:**
- Thuật toán: `scrypt`
- N: 16384 (mặc định của Node.js)
- r: 8 (mặc định của Node.js)
- p: 1 (mặc định của Node.js)
- keyLen: 64 bytes
- Salt: 16 bytes ngẫu nhiên (`crypto.randomBytes(16)`)
- Định dạng lưu trữ: `scrypt:<base64url-salt>:<base64url-hash>`
- So sánh hash bằng `timingSafeEqual` sau khi kiểm tra độ dài buffer.

**Chính sách mật khẩu:**
- Tối thiểu 8 ký tự.
- Khi đăng ký, mật khẩu được băm trước khi lưu vào `otp_requests`.
- Khi xác minh OTP thành công, hash được chuyển sang bảng `users`; không lưu mật khẩu plaintext.

### Điều chế kết nối Socket

### Chống spam trong chat

## Xác thực đầu vào và Chống tiêm nhiễm

### Bảo vệ đầu vào không đúng định dạng

**Phân tích JSON:**
- `api-service` dùng `express.json({ limit: "1mb" })`.
- JSON không hợp lệ bị Express JSON parser từ chối trước khi vào route.

**Middleware Bảo vệ Đầu vào:**
- Validation hiện được thực hiện thủ công theo từng route bằng `typeof`, regex, `isUuid()`, `isIsoDate()` và `parseLimit()`.
- Các trường như email, username, identifier, displayName và query tìm kiếm được trim/normalize theo route.

### Chống tiêm nhiễm SQL

**Phương pháp: Truy vấn tham số hóa (prepared statements)**
- Các truy vấn dùng thư viện `pg` với placeholder `$1, $2, ...` cho dữ liệu từ người dùng.
- UUID được kiểm tra bằng `isUuid()` trước khi đưa vào truy vấn.
- Query limit được kiểm tra phạm vi bằng `parseLimit()`.
- Các đoạn SQL động hiện có như hướng sắp xếp/cursor comparator được chọn từ logic server, không lấy trực tiếp từ input.

### Chống XSS (Frontend)

### Bảo vệ CSRF

### Chống tiêm nhiễm Email

- Email đăng ký được `trim().toLowerCase()` và validate bằng regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
- Regex email hiện tại loại bỏ whitespace, bao gồm newline/tab.
- OTP email được gửi bằng `nodemailer`; `from` lấy từ cấu hình SMTP, `subject` là hằng số, nội dung email chỉ chứa OTP do server sinh.

### Chống tiêm nhiễm Header

### Chống tiêm nhiễm Command

- Không có sử dụng `child_process.exec()`, `execFile()` hoặc `spawn()` trong `api-service/src`.
- Script entrypoint chỉ chạy migration và server bằng Node, không truyền input người dùng vào shell command.

## Mô hình đe dọa mức cơ bản

- Đã bao phủ:
  - credential stuffing mitigation basics.
  - token replay via rotation and revoke.
  - transit interception via TLS.
  - accidental sensitive logs.
- Chưa bao phủ đầy đủ:
  - nation-state active attacks.
  - device compromise.
  - full metadata protection.

## Checklist nghiệm thu bảo mật

- Password hashes validated against policy.
- Token rotation test passes.
- OTP expiry/attempt lock tests pass.
- Không lộ plaintext trong log ở flow bình thường.

## Trách nhiệm

- Phụ trách API: kiểm soát auth, OTP, token.
- Phụ trách Realtime: xác thực socket và giới hạn tần suất.
- Phụ trách FE: xử lý token an toàn phía client.
- System Owner: duyệt cổng bảo mật trước phát hành.

