# 08 - Kế Hoạch QA và Kiểm Thử

## Mục tiêu

Xác định chiến lược kiểm thử để đảm bảo các luồng quan trọng không bị vỡ khi tích hợp.

## Tầng kiểm thử

- Unit tests:
  - auth utils, validation, token services.
- Integration tests:
  - API endpoints with DB.
  - Realtime event routing with test clients.
- End-to-end tests:
  - login -> chat send/receive -> delivery/read.
  - voice/video call signaling happy path.

## Phân công kiểm thử

- Phụ trách FE:
  - UI state and socket client handling tests.
- Phụ trách API:
  - auth/otp/conversation/message endpoint tests.
- Phụ trách Realtime:
  - event contract routing and ack/error tests.
- System Owner:
  - cross-service E2E and release sign-off.

## Ma trận kiểm thử trọng yếu

### Xác thực
- register OTP request success/failure.
- OTP expire and retry limit.
- login by email and by username.
- access token expiry with refresh rotation.

### Tìm người dùng
- search by `@username` prefix.
- search by exact email behavior.
- rate limit behavior under repeated requests.

### Chat
- send encrypted message success.
- duplicate retry with same requestId deduped.
- recipient delivered/read states.
- reconnect and missed message sync.

### E2EE
- key exchange success.
- key rotation by message count.
- key rotation by time window.
- key mismatch and rekey recovery.

### Call (thoại/video)
- call start, accept, reject, timeout.
- offer/answer/ice relay.
- call end by either side.
- TURN fallback scenario.

## Kiểm thử phi chức năng

- Basic load test:
  - 50 concurrent sockets in staging.
- Latency budget:
  - chat ack under 1 second in normal conditions.
- Resilience:
  - service restart during reconnect scenario.

## Tiêu chí qua cổng phát hành

- No P0/P1 open defects.
- Critical matrix tests all pass.
- Smoke test pass on target environment.
- Contract diff reviewed if API/events changed.

## Mức độ lỗi

- P0: System down, auth broken, data loss, plaintext leak.
- P1: Core flow broken for common path.
- P2: Edge case bug with workaround.
- P3: Cosmetic and non-blocking issues.

## Mẫu báo cáo test

Each test run must report:

```txt
MaLanChay:
MoiTruong:
CommitSHA:
TongDatTruot:
LoiChanPhatHanh:
NguoiPhuTrach:
```

## Checklist Go/No-Go

- Auth and OTP stable.
- Chat E2EE send/receive stable.
- Voice and video call signaling stable.
- Deploy rollback validated.
- Known limitations documented.

