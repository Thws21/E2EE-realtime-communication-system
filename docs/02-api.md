# 02 - Hợp Đồng REST API

| Meta | Giá trị |
|------|---------|
| Contract-Version | 1.0.0 |
| Status | FROZEN |
| Frozen-At | 2026-05-16 |
| Naming | [`00-glossary-and-naming.md`](00-glossary-and-naming.md) |

## Mục tiêu

Tài liệu này mô tả hợp đồng API thống nhất cho xác thực, tìm người dùng, quản lý cuộc trò chuyện và truy vấn lịch sử tin nhắn.

## Quy ước chung

- Naming và glossary: [`00-glossary-and-naming.md`](00-glossary-and-naming.md).
- Base URL: `/api/v1`
- Xác thực: `Authorization: Bearer <access_token>`
- Kiểu dữ liệu: `application/json`
- ID chuẩn: UUID v7 (`string(uuid-v7)` trên wire)
- JSON field: `camelCase`; PostgreSQL (API): `snake_case` map sang JSON tại API layer
- Thời gian: ISO 8601 UTC

## Chuẩn response

### Thành công

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

### Lỗi

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Mo ta loi",
    "requestId": "<uuid-v7>"
  }
}
```

## Xác thực và OTP

### POST `/auth/register/request-otp`

Mục đích: yêu cầu OTP đăng ký qua email.

Request:
```txt
email: string(email) [required]
username: string [required]
password: string [required]
displayName: string [required]
```

Response:
```txt
otpRequestId: string(uuid-v7)
expiresInSec: number       [= 600, tương đương 10 phút]
cooldownSec: number        [= 60]
delivery: string           [= "email"]
otpCode: string            [chỉ có khi NODE_ENV=development và email gửi thành công]
```

Quy tắc:
- SMTP phải được cấu hình đủ (`SMTP_HOST/PORT/USER/PASS/FROM`). Thiếu → 503 `INTERNAL_ERROR`.
- OTP được gửi qua email (Nodemailer). Server không trả mã OTP trong production.
- Trong môi trường `development`, response có thêm `otpCode` để test không cần mailbox thật.
- Giới hạn tần suất theo IP và theo email.
- Không để lộ email đã tồn tại hay chưa trong thông báo phản hồi.

### POST `/auth/register/verify-otp`

Request:
```txt
otpRequestId: string(uuid-v7) [required]
otpCode: string(6 digits) [required]
```

Response:
```txt
userId: string(uuid-v7)
user: object [required, giống /auth/login]
accessToken: string
refreshToken: string
expiresInSec: number [required]
```

### POST `/auth/login`

Request:
```txt
identifier: string [required, email hoặc username]
password: string [required]
deviceInfo: object [required]
deviceInfo.deviceId: string(uuid-v7) [optional, server sinh UUID v7 nếu thiếu]
```

Response:
```txt
user: object [required]
accessToken: string [required]
refreshToken: string [required]
expiresInSec: number [required]
```

### POST `/auth/refresh`

Request:
```txt
refreshToken: string [required]
```

Response:
```txt
accessToken: string [required]
refreshToken: string [required, có xoay vòng]
refreshTokenId: string(uuid-v7) [required]
expiresInSec: number [required]
```

### POST `/auth/logout`

Request:
```txt
refreshToken: string [required]
```

Response:
```txt
revoked: boolean [required]
```

### POST `/auth/logout-all`

Mục đích: thu hồi toàn bộ phiên của người dùng hiện tại.

Response:
```txt
revokedSessionCount: number [required]
```

## Access token JWT claims

Issuer: **API Service**. Realtime và REST dùng chung access token từ login/refresh/verify-otp.

Baseline (chi tiết: [`06-security.md`](06-security.md)):

```txt
sub: string(uuid-v7) [required]
sid: string(uuid-v7) [required]
deviceId: string(uuid-v7) [required]
iat: number [required]
exp: number [required]
```

Quy tắc:
- Claim phiên là `sid` (không dùng tên `sessionId` trong JWT payload).
- `deviceId` lấy từ `deviceInfo.deviceId` khi client gửi hợp lệ; API sinh UUID v7 nếu thiếu và lưu trong `sessions.device_info`.

## Tìm người dùng

### GET `/users/search?q=<query>&limit=<n>&cursor=<cursor>`

Hành vi:
- Nếu query bắt đầu bằng `@`, tìm theo tiền tố username.
- Nếu query có định dạng email, chỉ tìm chính xác theo email.

Response item:
```txt
userId: string(uuid-v7) [required]
username: string [required]
displayName: string [required]
avatarUrl: string [optional]
```

Quy tắc riêng tư:
- Không trả email thô trong kết quả tìm kiếm công khai.
- Endpoint tìm kiếm bắt buộc có rate limit.

### GET `/users/{userId}/ecdh-public-key`

Lấy public key ECDH P-256 (SPKI base64) mới nhất của user — dùng cho G-lite first-message setup.

Response:
```txt
userId: string(uuid-v7) [required]
deviceId: string(uuid-v7) [required]
publicKey: string(base64 SPKI) [required]
updatedAt: string(iso8601) [required]
```

Lỗi `404` với code `DEVICE_PREKEY_NOT_FOUND` nếu user tồn tại nhưng chưa upload key (chưa login lần nào sau migrate).
Lỗi `404` với code `USER_NOT_FOUND` nếu userId không tồn tại.

Giới hạn: một key “active” mỗi user (bản ghi `updated_at` mới nhất); không chọn device khi peer có nhiều thiết bị.

### PUT `/devices/me/ecdh-public-key`

Đăng ký hoặc cập nhật public key của device hiện tại (từ JWT `deviceId`).

Request:
```txt
publicKey: string(base64 SPKI) [required]
```

## Cuộc trò chuyện

### POST `/conversations/direct`

Tạo mới hoặc lấy lại cuộc trò chuyện trực tiếp đã tồn tại.

Request:
```txt
peerUserId: string(uuid-v7) [required]
```

Response:
```txt
conversationId: string(uuid-v7) [required]
type: string [required, DIRECT]
members: array<object> [required]
```

### GET `/conversations`

Lấy danh sách cuộc trò chuyện có phân trang.

Query:
```txt
limit: number [optional]
cursor: string [optional]
```

Response item:
```txt
conversationId: string(uuid-v7) [required]
type: string [required]
lastMessagePreview: object [optional]
unreadCount: number [required]
updatedAt: string(iso8601) [required]
```

## Tin nhắn

### GET `/conversations/{conversationId}/messages`

Request query:
```txt
limit: number [optional]
afterMessageId: string(uuid-v7) [optional]
beforeMessageId: string(uuid-v7) [optional]
```

Response item:
```txt
messageId: string(uuid-v7) [required]
conversationId: string(uuid-v7) [required]
senderUserId: string(uuid-v7) [required]
ciphertext: string(base64) [required]
nonce: string(base64) [required]
algorithm: string [required]
keyVersion: number [required]
createdAt: string(iso8601) [required]
```

### POST `/internal/messages/persist` (chỉ dùng nội bộ)

Dùng cho realtime service gọi API để lưu dữ liệu.

Request:
```txt
requestId: string(uuid-v7) [required]
messageId: string(uuid-v7) [required]
conversationId: string(uuid-v7) [required]
senderUserId: string(uuid-v7) [required]
senderDeviceId: string(uuid-v7) [required]
envelope: object [required]
```

Response:
```txt
stored: boolean [required]
createdAt: string(iso8601) [required]
deduped: boolean [required]
```

Quy tắc bảo mật nội bộ:
- Endpoint này chỉ chấp nhận gọi từ Realtime service đã xác thực service-to-service.
- `senderUserId` và `senderDeviceId` phải là giá trị Realtime suy ra từ auth context handshake, không lấy trực tiếp từ client payload.

### POST `/internal/calls/persist` (chỉ dùng nội bộ)

Lưu lịch sử cuộc gọi khi call kết thúc (reject/end/timeout).

Request:
```txt
callId: string(uuid) [required]
conversationId: string(uuid) [required]
callerId: string(uuid) [required]
callType: string [required, voice|video]
status: string [required, missed|rejected|completed|ended]
startedAt: string(iso8601) [optional]
endedAt: string(iso8601) [optional]
```

Response:
```txt
stored: boolean [required]
createdAt: string(iso8601) [required]
deduped: boolean [required]
```

`receiverId` được API suy ra từ `conversation_members` (direct 1-1), không tin client.

### GET `/conversations/{conversationId}/calls`

Bearer JWT, chỉ member.

Query: `limit`, `beforeCallId` (cursor).

Response:
```txt
calls: CallLogItem[] [required]
nextCursor: string(uuid) [optional]
```

Mỗi `CallLogItem`: `callId`, `conversationId`, `callerId`, `receiverId`, `callType`, `status`, `startedAt`, `endedAt`, `durationSec`, `createdAt`.

## Trạng thái nhận và đọc

### POST `/messages/{messageId}/delivered`

Request:
```txt
deliveredAt: string(iso8601) [required]
```

### POST `/conversations/{conversationId}/read`

Request:
```txt
lastReadMessageId: string(uuid-v7) [required]
readAt: string(iso8601) [required]
```

## Mã lỗi chuẩn

- `VALIDATION_FAILED`
- `AUTH_INVALID_CREDENTIALS`
- `AUTH_TOKEN_EXPIRED`
- `AUTH_REFRESH_REVOKED`
- `AUTH_REFRESH_REPLAY_DETECTED`
- `AUTH_SESSION_REVOKED`
- `OTP_INVALID`
- `OTP_EXPIRED`
- `OTP_RATE_LIMITED`
- `USER_NOT_FOUND`
- `CONVERSATION_NOT_FOUND`
- `PERMISSION_DENIED`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

## Quy tắc idempotency

- Hỗ trợ header `Idempotency-Key` cho endpoint ghi dữ liệu.
- Endpoint persist nội bộ dùng khóa dedupe:
  - `requestId + senderDeviceId`.

## Yêu cầu quản lý phiên và refresh token

- Mỗi lần login phải tạo một `sessionId` riêng.
- Refresh token phải lưu dưới dạng băm trong kho phiên (không lưu plaintext).
- Khi gọi `/auth/refresh`:
  - token cũ bị thu hồi ngay sau khi cấp token mới;
  - nếu token cũ bị dùng lại, hệ thống trả `AUTH_REFRESH_REPLAY_DETECTED` và thu hồi cả chuỗi phiên liên quan.
- `/auth/logout` thu hồi phiên hiện tại.
- `/auth/logout-all` thu hồi toàn bộ phiên của user.

## Chính sách Redis cho auth/OTP (v1)

- Nguồn dữ liệu chuẩn (source of truth) cho OTP, session, refresh token hash là PostgreSQL.
- Redis không dùng làm storage chính cho OTP/session ở v1.
- Redis chỉ dùng cho:
  - counter rate limit theo IP/email;
  - cache TTL ngắn để giảm tải truy vấn lặp;
  - dữ liệu tạm có thể tái dựng từ PostgreSQL khi Redis mất dữ liệu.

## Trách nhiệm

- API Owner phải giữ tương thích khi thay đổi version.
- Realtime Owner chỉ dùng endpoint nội bộ đã được công bố.
- FE Owner phải xử lý đầy đủ các mã lỗi chuẩn.
- System Owner duyệt mọi thay đổi breaking change.

## Vấn đề đã biết (Known Issues — chưa fix)

> Những điểm dưới đây là lệch lạc đang tồn tại giữa spec contract và implementation thực tế. Ghi lại để team ưu tiên fix.

- ~~**GET `/conversations` response shape mismatch**~~ — Đã fix: API trả `{ conversations, nextCursor }`.
- ~~**GET `/conversations/:id/messages` tương tự**~~ — Đã fix: API trả `{ messages, nextCursor }` với `envelope` lồng.
- ~~**Chưa có endpoint tìm người dùng**~~ — Đã có `GET /users/search`; hỗ trợ cả `@username` (strip `@`) và email.
- **verify-otp:** từ 2026-06 trả thêm `user` object + `expiresInSec` (đồng bộ với `/login`) để FE vào thẳng phiên sau đăng ký.
- **lastMessagePreview:** `preview` không còn trả ciphertext (E2EE, server không giải mã được); FE hiển thị placeholder.
- **Realtime `chat:message`:** payload phẳng (theo `03-events.md`); FE tự map sang `envelope` để giải mã.

## Changelog

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0.0 | 2026-05-16 | System Owner | Initial freeze V1: UUID v7, naming ref `00`, contract status FROZEN |
| 1.0.0-clarify | 2026-05-24 | System Owner | Clarify: optional `deviceInfo.deviceId`; JWT claims `sid`/`deviceId` (không đổi response shape) |
| 1.0.1-impl | 2026-06-13 | System Owner | Document thực tế: request-otp thêm field `delivery`, `otpCode` (dev only); SMTP bắt buộc; known issues shape mismatch |
