# 00 - Glossary và Quy ước Naming

## Metadata

| Meta | Giá trị |
|------|---------|
| Áp dụng từ | 2026-05-16 |
| Owner | System Owner |
| Tham chiếu | `01-architecture.md`, `02-api.md`, `03-events.md`, `05-e2ee.md`, `06-security.md`, `09-team-raci.md` |

Đọc tài liệu này trước khi implement hoặc review contract. Mọi thuật ngữ và quy ước đặt tên dưới đây là chuẩn cho REST, Socket.IO, PostgreSQL và client.

---

## 1. Glossary

| Thuật ngữ | Định nghĩa ngắn | Ghi chú |
|-----------|-----------------|--------|
| **user** | Tài khoản đã đăng ký và xác thực | `userId` = UUID v7 |
| **device** | Thiết bị/browser đăng nhập một phiên | `senderDeviceId`, JWT claim `deviceId` |
| **session** | Phiên đăng nhập gắn refresh token và `sessionId` | Source of truth: PostgreSQL |
| **conversation** | Cuộc trò chuyện; v1 chỉ `DIRECT` (1-1) | `conversationId` |
| **message** | Bản ghi tin nhắn đã persist | Server chỉ lưu ciphertext |
| **envelope** | Gói E2EE: ciphertext, nonce, algorithm, keyVersion, … | Khớp `05-e2ee.md` |
| **plaintext** | Nội dung tin chưa mã hóa | Chỉ trên client memory |
| **ciphertext** | Dữ liệu đã mã hóa (base64 trên wire) | Không giải mã trên server |
| **keyVersion** | Phiên bản khóa đố称 cho conversation | Tăng khi rotate |
| **handshake** | Bước kết nối Socket.IO có access token | Auth một lần; không token per event |
| **presence** | Trạng thái online/offline/away | Realtime; không persist lâu dài như message |
| **signaling** | Relay offer/answer/ICE cho WebRTC | Qua socket `call:*`; media peer-to-peer |
| **gateway** | Nginx cổng 80, same-origin | `/api/v1`, `/socket.io/` |
| **OTP** | Mã xác thực email đăng ký | `otpRequestId`; không leak email tồn tại |
| **refresh rotation** | Mỗi refresh cấp token mới, thu hồi token cũ | Replay → revoke chain |
| **requestId** | ID theo dõi request/event client | Idempotency + ack matching |
| **dedupe** | Chống xử lý trùng cùng request/event | Khóa xem mục 4 |
| **replay** | Gửi lại nonce/envelope đã dùng | Từ chối theo `03-events.md` |
| **internal API** | REST chỉ Realtime → API (S2S) | Ví dụ `/internal/messages/persist` |
| **ack / system:error** | Phản hồi chuẩn socket từ server | Không dùng HTTP status trên socket |

---

## 2. Naming theo lớp

### 2.1 JSON (REST body, socket payload, client state)

| Quy tắc | Ví dụ |
|---------|--------|
| `camelCase` cho mọi property | `userId`, `conversationId`, `lastReadMessageId` |
| Thời gian: hậu tố `At` | `createdAt`, `deliveredAt`, `readAt` |
| Boolean mới: tiền tố `is` / `has` / `can` khi phù hợp | `isAccepted`, `hasUnread` |
| Không dùng `snake_case` trên wire public | ❌ `conversation_id` trong JSON API |

### 2.2 REST URL

| Quy tắc | Ví dụ |
|---------|--------|
| Prefix version | `/api/v1` |
| Segment path: `kebab-case` | `/auth/register/request-otp` |
| Path parameter: `camelCase` trong doc | `{conversationId}`, `{messageId}` |

### 2.3 Socket.IO event names

| Quy tắc | Ví dụ |
|---------|--------|
| `domain:action`, chữ thường | `chat:send`, `presence:update` |
| Sub-domain key (3 segment, ngoại lệ có chủ đích) | `key:exchange:init` |
| System events | `system:ack`, `system:error` |

### 2.4 Mã lỗi

| Lớp | Field chứa mã | Format |
|-----|---------------|--------|
| REST | `error.code` | `SCREAMING_SNAKE` |
| Socket | `system:error.errorCode` | `SCREAMING_SNAKE` |

Cùng semantics có thể dùng cùng chuỗi mã; tên field khác nhau giữa REST và socket là **cố ý** (xem mục 7).

### 2.5 PostgreSQL (API Owner)

| Quy tắc | Ví dụ |
|---------|--------|
| Bảng và cột: `snake_case` | `conversation_members`, `sender_device_id` |
| PK: `id` (UUID v7) hoặc `{entity}_id` khi rõ nghĩa | `users.id`, hoặc FK `conversation_id` |
| API layer map DB → JSON `camelCase` | `conversation_id` → `conversationId` |

Ví dụ map:

```txt
DB column          → JSON field
conversation_id    → conversationId
sender_device_id   → senderDeviceId
created_at         → createdAt
```

### 2.6 Biến môi trường

| Quy tắc | Ví dụ |
|---------|--------|
| Server: `SCREAMING_SNAKE` | `DATABASE_URL`, `JWT_ACCESS_SECRET` |
| Vite client: prefix `VITE_` | `VITE_API_BASE_URL` |

### 2.7 Repository và Git

| Quy tắc | Ví dụ |
|---------|--------|
| Branch | `feature/<domain>-<short-name>`, `fix/<domain>-<short-name>` |
| Service directories | `api-service`, `realtime-service`, `frontend` |
| Task ID (roadmap) | `SYS-01`, `API-04`, `RT-02` |

---

## 3. ID và kiểu dữ liệu

### 3.1 UUID v7

- Trên wire: ghi trong contract là `string(uuid-v7)` (RFC 9562).
- Mọi ID **mới** do hệ thống hoặc client sinh ra (`userId`, `conversationId`, `messageId`, `requestId`, `callId`, `otpRequestId`, …) phải là **UUID v7**.
- Không dùng integer sequential làm public ID.
- So sánh tie-break (ví dụ `key:rotate`): chuỗi UUID canonical **lowercase**.
- Gợi ý implement: Node `uuid` package v9+ (`v7()`); kiểm tra runtime trước khi dùng `crypto.randomUUID()` nếu chưa đảm bảo v7.

### 3.2 Thời gian và binary

| Kiểu | Quy ước |
|------|---------|
| Thời gian | ISO 8601 UTC string, ví dụ `2026-05-16T10:00:00.000Z` |
| Ciphertext, nonce, publicKey | base64 string |
| OTP code | 6 chữ số (không phải UUID) |

---

## 4. Khóa idempotency và dedupe (tham chiếu)

| Luồng | Khóa |
|-------|------|
| REST ghi (header) | `Idempotency-Key` |
| Persist nội bộ API | `requestId` + `senderDeviceId` |
| Socket event client | `requestId` + `senderDeviceId` + `conversationId` |
| Replay tin nhắn E2EE | `senderDeviceId` + `conversationId` + `nonce` + `keyVersion` |

---

## 5. Canonical fields (không đổi tên tùy ý sau contract freeze)

`userId`, `conversationId`, `messageId`, `senderUserId`, `senderDeviceId`, `requestId`, `keyVersion`, `otpRequestId`, `refreshTokenId`, `sessionId`, `callId`, `callType`, `peerUserId`, `serverEventId`, `eventVersion`, `clientMessageSeq`, `accessToken`, `refreshToken`, `expiresInSec`, `cooldownSec`.

Thêm field mới: tuân quy tắc additive trong `09-team-raci.md` (Contract freeze V1).

---

## 6. Anti-patterns

- Tin tưởng `senderUserId` do client gửi — server **luôn** lấy từ auth context handshake.
- Đưa `authToken` vào từng socket event payload.
- `snake_case` trong JSON public REST/socket.
- Đổi tên hoặc đổi kiểu field `required` đã frozen mà không quy trình `contract-breaking`.
- Lưu plaintext message hoặc password trên server.
- Trả email thô trong kết quả tìm kiếm công khai.

---

## 7. REST ↔ Socket error mapping (subset)

Layer khác nhau **được phép** dùng mã ngắn hơn trên socket; FE map UX thống nhất.

| Ngữ cảnh | REST `error.code` | Socket `errorCode` | Ghi chú |
|----------|-------------------|--------------------|---------|
| Sai credential đăng nhập | `AUTH_INVALID_CREDENTIALS` | `AUTH_INVALID` | Socket gom lỗi auth |
| Access token hết hạn | `AUTH_TOKEN_EXPIRED` | `AUTH_INVALID` | FE: đăng nhập lại |
| Refresh replay | `AUTH_REFRESH_REPLAY_DETECTED` | — | Chỉ REST |
| Không đủ quyền conversation | `PERMISSION_DENIED` | `PERMISSION_DENIED` | Cùng mã |
| Conversation không tồn tại | `CONVERSATION_NOT_FOUND` | `CONVERSATION_NOT_FOUND` | Cùng mã |
| Rate limit | `RATE_LIMITED` | `RATE_LIMITED` | Cùng mã |
| Persist message thất bại | `INTERNAL_ERROR` | `MESSAGE_PERSIST_FAILED` | Socket cụ thể hơn |
| Key version lệch | — | `KEY_VERSION_MISMATCH` | Chủ yếu socket/E2EE |
| Xung đột trạng thái call | — | `CALL_STATE_CONFLICT` | Chủ yếu socket |

Không bắt buộc đồng bộ 1:1 toàn bộ mã giữa REST và socket.

---

## 8. Trách nhiệm

| Owner | Trách nhiệm naming |
|-------|-------------------|
| System Owner | Duy trì `00`, duyệt thay đổi breaking contract |
| API Owner | `snake_case` schema/migration; map sang JSON |
| Realtime Owner | Tên event và payload socket |
| FE Owner | Client state và `VITE_*` align contract |
