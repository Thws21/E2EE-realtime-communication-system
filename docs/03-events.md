# 03 - Hợp Đồng Sự Kiện Realtime

| Meta | Giá trị |
|------|---------|
| Contract-Version | 1.0.0 |
| Status | FROZEN |
| Frozen-At | 2026-05-16 |
| Naming | [`00-glossary-and-naming.md`](00-glossary-and-naming.md) |

## Mục tiêu

Tài liệu này định nghĩa toàn bộ sự kiện Socket.IO để frontend, realtime và API triển khai thống nhất, không lệch hợp đồng.

## Quy tắc toàn cục

- Naming và glossary: [`00-glossary-and-naming.md`](00-glossary-and-naming.md).
- Quy ước tên: `domain:action` (ví dụ `chat:send`).
- Mọi event do client khởi tạo bắt buộc có:
  - `requestId: string(uuid-v7)`
  - `timestamp: string(iso8601)`
- Xác thực socket chỉ thực hiện tại handshake:
  - Client phải gửi access token ở bước handshake qua `socket.handshake.auth.accessToken`.
  - Event payload không mang `authToken` lặp lại cho mỗi event.
- Mọi phản hồi từ server phải là một trong hai:
  - `system:ack`
  - `system:error`

## Quy tắc bắt buộc theo phạm vi sự kiện

- Các event thuộc nhóm `chat:*`, `call:*`, `key:*` bắt buộc có `conversationId`.
- Event thuộc nhóm `presence:*` không yêu cầu `conversationId`.
- Event thuộc nhóm `conversation:*` dùng để quản lý room socket và bắt buộc có `conversationId`.
- Realtime phải từ chối event với lỗi `PERMISSION_DENIED` nếu `senderUserId` không thuộc conversation mục tiêu.
- `senderUserId` phải được lấy từ phiên đã xác thực ở handshake.
- Nếu client gửi `senderUserId` trong payload, server phải bỏ qua và dùng giá trị từ auth context.

## Envelope chung

```txt
requestId: string(uuid-v7) [required]
eventVersion: number [required]
senderUserId: string(uuid-v7) [required, server-derived-from-auth-context]
senderDeviceId: string(uuid-v7) [required]
timestamp: string(iso8601) [required]
payload: object [required]
```

Lưu ý triển khai:
- Client chỉ gửi payload nghiệp vụ + `requestId` + `timestamp`.
- `senderUserId` và `senderDeviceId` là trường chuẩn hóa do Realtime gắn từ auth context handshake trước khi xử lý quyền hoặc persist.
- Client không được quyền override các trường này.

## Envelope Ack/Error

### system:ack

```txt
requestId: string(uuid-v7) [required]
status: string [required, fixed="ok"]
serverEventId: string(uuid-v7) [required]
serverTimestamp: string(iso8601) [required]
meta: object [optional]
```

### system:error

```txt
requestId: string(uuid-v7) [required]
status: string [required, fixed="error"]
errorCode: string [required]
errorMessage: string [required]
retryable: boolean [required]
details: object [optional]
```

## Nhóm sự kiện `presence`

### presence:subscribe
- Bên gửi: Client
- Bên nhận: Realtime
- Mục đích: đăng ký nhận trạng thái online/offline.

Payload:
```txt
targets: array<string(uuid-v7)> [required]
```

### presence:update
- Bên gửi: Realtime
- Bên nhận: Clients
- Mục đích: đẩy cập nhật online/offline/lastSeen.

Payload:
```txt
userId: string(uuid-v7) [required]
status: string [required, online|offline|away]
lastSeenAt: string(iso8601) [optional]
```

## Nhóm sự kiện `realtime`

### realtime:resubscribe
- Bên gửi: Client
- Bên nhận: Realtime
- Mục đích: khôi phục room conversation và presence targets sau khi socket reconnect.

Payload:
```txt
conversationIds: array<string(uuid-v7)> [optional]
presenceTargets: array<string(uuid-v7)> [optional]
```

Hành vi khi thành công:
- Realtime kiểm tra quyền từng conversation trước khi join room.
- Realtime đăng ký lại presence targets và gửi `presence:update` hiện tại.
- Realtime trả `system:ack`.

## Nhóm sự kiện `conversation`

### conversation:join
- Bên gửi: Client
- Bên nhận: Realtime
- Mục đích: tham gia Socket.IO room của conversation để nhận chat/call/key event liên quan.

Payload:
```txt
conversationId: string(uuid-v7) [required]
```

Hành vi khi thành công:
- Realtime kiểm tra `senderUserId` từ auth context có thuộc conversation không.
- Realtime gọi `socket.join("conversation:{conversationId}")`.
- Realtime trả `system:ack` cho client.

### conversation:leave
- Bên gửi: Client
- Bên nhận: Realtime
- Mục đích: rời Socket.IO room của conversation khi không còn cần nhận realtime event.

Payload:
```txt
conversationId: string(uuid-v7) [required]
```

Hành vi khi thành công:
- Realtime gọi `socket.leave("conversation:{conversationId}")`.
- Realtime trả `system:ack` cho client.

### conversation:created
- Bên gửi: Realtime (sau khi API gọi `POST /internal/conversations/notify-created`)
- Bên nhận: Client (peer được mời vào direct conversation)
- Mục đích: refresh danh sách conversation khi có người khác tạo chat direct với mình.

Payload:
```txt
conversationId: string(uuid-v7) [required]
initiatorUserId: string(uuid-v7) [required]
initiatorDisplayName: string [optional]
```

Hành vi:
- Realtime emit tới mọi socket đang kết nối của `peerUserId` (người nhận thông báo).
- Client nên gọi lại `GET /conversations` để hiển thị chat mới mà không cần search ngược.

## Nhóm sự kiện `chat`

### chat:send
- Bên gửi: Client
- Bên nhận: Realtime
- Mục đích: gửi tin nhắn đã mã hóa để lưu và chuyển tiếp.

Payload:
```txt
conversationId: string(uuid-v7) [required]
messageId: string(uuid-v7) [required]
ciphertext: string(base64) [required]
nonce: string(base64) [required]
algorithm: string [required, aes-256-gcm]
keyVersion: number [required]
aad: object [optional]
clientMessageSeq: number [required]
```

Hành vi khi thành công:
- Realtime gọi API nội bộ để persist.
- Nếu lưu thành công, realtime gửi `system:ack` cho người gửi rồi phát `chat:message` cho người nhận.

### chat:message
- Bên gửi: Realtime
- Bên nhận: các thành viên trong conversation
- Mục đích: chuyển tiếp ciphertext envelope.

Payload:
```txt
messageId: string(uuid-v7) [required]
conversationId: string(uuid-v7) [required]
senderUserId: string(uuid-v7) [required]
senderDeviceId: string(uuid-v7) [required]
ciphertext: string(base64) [required]
nonce: string(base64) [required]
algorithm: string [required]
keyVersion: number [required]
aad: object [optional, wire metadata e.g. G-lite setup]
createdAt: string(iso8601) [required]
```

### chat:delivered
- Bên gửi: Client
- Bên nhận: Realtime -> API -> Participants
- Mục đích: đánh dấu đã nhận.

Payload:
```txt
conversationId: string(uuid-v7) [required]
messageId: string(uuid-v7) [required]
deliveredAt: string(iso8601) [required]
```

### chat:read
- Bên gửi: Client
- Bên nhận: Realtime -> API -> Participants
- Mục đích: đánh dấu đã đọc.

Payload:
```txt
conversationId: string(uuid-v7) [required]
lastReadMessageId: string(uuid-v7) [required]
readAt: string(iso8601) [required]
```

## Nhóm sự kiện `key`

### key:exchange:init

Payload:
```txt
conversationId: string(uuid-v7) [required]
curve: string [required, x25519|p256]
publicKey: string(base64) [required]
sessionProposalId: string(uuid-v7) [required]
```

### key:exchange:response

Payload:
```txt
conversationId: string(uuid-v7) [required]
sessionProposalId: string(uuid-v7) [required]
publicKey: string(base64) [required]
accepted: boolean [required]
```

### key:rotate

Payload:
```txt
conversationId: string(uuid-v7) [required]
newKeyVersion: number [required]
reason: string [required, message_count|time_window|manual]
senderEphemeralPublicKey: string(base64) [required]
```

> **FE (bản tối thiểu):** `senderEphemeralPublicKey` mang `rotationSalt` (HKDF salt, 32 byte random base64), **không** phải ECDH public key. Cùng salt được nhúng trong `envelope.aad` của tin đầu sau rotate để peer offline vẫn derive được.

### key:rekey_required

Payload:
```txt
conversationId: string(uuid-v7) [required]
expectedKeyVersion: number [required]
receivedKeyVersion: number [required]
reason: string [required]
```

## Nhóm sự kiện `call`

### call:start

Payload:
```txt
callId: string(uuid-v7) [required]
conversationId: string(uuid-v7) [required]
callType: string [required, voice|video]
```

### call:incoming

Payload:
```txt
callId: string(uuid-v7) [required]
conversationId: string(uuid-v7) [required]
callerUserId: string(uuid-v7) [required]
callType: string [required]
expiresAt: string(iso8601) [required]
```

### call:accept / call:reject / call:end

Payload:
```txt
callId: string(uuid-v7) [required]
conversationId: string(uuid-v7) [required]
reason: string [optional]
```

### call:offer / call:answer

Payload:
```txt
callId: string(uuid-v7) [required]
conversationId: string(uuid-v7) [required]
sdp: string [required]
sdpType: string [required, offer|answer]
```

### call:ice

Payload:
```txt
callId: string(uuid-v7) [required]
conversationId: string(uuid-v7) [required]
candidate: object [required]
```

## Idempotency và retry

- `requestId + senderDeviceId + conversationId` được dùng làm khóa dedupe cho event từ client.
- Realtime phải trả cùng kết quả `system:ack` cho yêu cầu trùng trong cửa sổ dedupe.
- Với `chat:send`, hệ thống phải từ chối replay nếu trùng cặp `senderDeviceId + conversationId + nonce` trong cùng `keyVersion`.
- Chính sách retry phía client:
  - exponential backoff: 500ms, 1s, 2s, 4s, stop at 5 attempts.
  - stop retry when `retryable=false`.

## Quy tắc xử lý xung đột xoay khóa

- Nếu cả hai bên cùng phát `key:rotate`, chọn bản ghi có:
  1. `newKeyVersion` lớn hơn.
  2. Nếu bằng nhau, ưu tiên `senderUserId` có giá trị UUID v7 nhỏ hơn theo thứ tự từ điển (canonical lowercase).
- Bên bị loại phải đồng bộ lại khóa và gửi `system:ack` cho rotate được chấp nhận.

## Mã lỗi tối thiểu

- `AUTH_INVALID`
- `PERMISSION_DENIED`
- `CONVERSATION_NOT_FOUND`
- `RATE_LIMITED`
- `MESSAGE_PERSIST_FAILED`
- `KEY_VERSION_MISMATCH`
- `CALL_STATE_CONFLICT`
- `INTERNAL_ERROR`

## REST ↔ Socket error mapping

Bảng map subset giữa REST `error.code` và socket `errorCode`: xem mục 7 trong [`00-glossary-and-naming.md`](00-glossary-and-naming.md).

## Trách nhiệm

- Phụ trách Realtime: triển khai transport và event routing.
- Phụ trách API: triển khai tác vụ lưu trạng thái message/receipt.
- Phụ trách FE: triển khai handler sự kiện và retry phía client.
- System Owner: kiểm tra tương thích hợp đồng và chốt version.

## Changelog

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0.0 | 2026-05-16 | System Owner | Initial freeze V1: thêm `conversationId` vào `chat:send` và `chat:delivered`; UUID v7; FROZEN |
| 1.0.0-clarify | 2026-05-24 | System Owner | Clarify: handshake field name `accessToken` trong `handshake.auth` (không đổi contract shape) |

