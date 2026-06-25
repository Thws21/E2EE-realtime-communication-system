# 07 - Triển Khai và CI/CD

## Mục tiêu

Cung cấp kế hoạch triển khai free-tier và pipeline CI/CD có thể chạy thật đến giai đoạn demo/chấm điểm.

## Stack triển khai miễn phí mục tiêu

- Frontend: Vercel free.
- API Service: Render/Railway-like free web service.
- Realtime Service: Render/Railway-like free web service.
- PostgreSQL: Neon/Supabase free tier.
- Redis: Upstash/Redis free tier (optional v1, bật khi cần rate-limit/cache/socket scale).
- TURN: coturn on always-free VM.

## Môi trường

- `local`: Docker Compose — một cổng vào `http://localhost` (service `gateway` :80). Dev: copy `.env.example` → `.env`, `docker compose up --build` (tự load `compose.override.yaml` cho bind-mount + hot reload). Biến: `BUILD_TARGET=development`, `NGINX_CONF=nginx.dev.conf` (proxy Vite qua gateway).
- `staging`: integration testing environment.
- `prod`: `docker compose -f compose.yaml --env-file .env.prod up --build -d` (không dùng override). `BUILD_TARGET=runtime`, `NGINX_CONF=nginx.conf` (static SPA từ `frontend/dist`).

## Biến môi trường bắt buộc

### Shared
- `NODE_ENV`
- `LOG_LEVEL`
- `CORS_ALLOWED_ORIGINS`

### API
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `API_INTERNAL_TOKEN`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

> **Lưu ý:** Tất cả 5 biến SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) phải có đủ để endpoint `POST /auth/register/request-otp` hoạt động. Thiếu bất kỳ biến nào → `sendRegistrationOtp` throw → endpoint trả 503. Trong local dev có thể dùng Mailtrap hoặc Gmail App Password.

### Realtime
- `API_INTERNAL_BASE_URL`
- `API_INTERNAL_TOKEN`
- `SOCKET_CORS_ORIGINS`
- `REDIS_URL` (optional v1, required when scaling)

## Chính sách lưu trữ OTP/session/token

- PostgreSQL là source of truth cho OTP records, session và refresh token hash.
- Redis chỉ dùng cho lớp hiệu năng (rate-limit counters, cache TTL ngắn, Socket.IO adapter/pub-sub).
- Không dùng Redis làm storage chính cho OTP/session ở v1 để giữ audit trail và replay-detection ổn định.

### Frontend
- `VITE_API_BASE_URL`
- `VITE_SOCKET_BASE_URL`
- `VITE_STUN_SERVERS`
- `VITE_TURN_URL`
- `VITE_TURN_USERNAME`
- `VITE_TURN_CREDENTIAL`

## Secrets matrix (SYS-13)

| Secret / flag | Service | Local dev | Staging / Prod |
|---------------|---------|-----------|----------------|
| `POSTGRES_PASSWORD` | compose root | example default | strong unique, không dùng `e2ee_pass` |
| `JWT_ACCESS_SECRET` | api + realtime | shared placeholder (`change-me`) | strong random, **khớp** giữa 2 service |
| `JWT_REFRESH_SECRET` | api | dev placeholder | strong unique, khác access secret |
| `API_INTERNAL_TOKEN` | api + realtime | dev placeholder | strong random, **khớp** giữa 2 service |
| `ALLOW_DEV_MESSAGE_PERSIST` | realtime | `true` (local only) | `false` |
| `SMTP_*` | api | optional / mailtrap | required, credentials từ secret manager |
| `VITE_*` | frontend | build-time, public | không đặt secret thật trong `VITE_*` |
| `VITE_TURN_*` | frontend | empty (tuần 6+) | từ coturn VM, rotate credential |

Template files (copy, không commit `.env` thật):

- [`.env.example`](../.env.example) — compose dev
- [`.env.prod.example`](../.env.prod.example) — compose prod
- [`api-service/.env.example`](../api-service/.env.example)
- [`realtime-service/.env.example`](../realtime-service/.env.example)
- [`frontend/.env.example`](../frontend/.env.example)

### Checklist trước deploy

1. `JWT_ACCESS_SECRET` api ↔ realtime khớp; `API_INTERNAL_TOKEN` khớp giữa 2 service.
2. `ALLOW_DEV_MESSAGE_PERSIST` tắt (`false`); dev socket token (`dev:...`) không dùng ở staging/prod.
3. `POSTGRES_PASSWORD`, `JWT_*`, `SMTP_*`, `API_INTERNAL_TOKEN` đã rotate — không dùng `change-me`.
4. `CORS_ALLOWED_ORIGINS` / `SOCKET_CORS_ORIGINS` allowlist đúng origin FE.
5. Sau pull: so sánh từng `.env` với `.env.example` — bổ sung key mới, không ghi đè secret đã rotate.

## Entry point strategy (free-tier)

**Option A — Split deploy:** Vercel (FE) + Render/Railway (API + Realtime) + Neon/Supabase (DB). Không có nginx chung; phải cấu hình CORS (`CORS_ALLOWED_ORIGINS`) và `SOCKET_CORS_ORIGINS` allowlist chính xác. `VITE_API_BASE_URL` / `VITE_SOCKET_BASE_URL` trỏ URL public từng service.

**Option B — Single VM (khuyến nghị demo):** Một máy chạy `compose.yaml` + service `gateway` + TLS termination (Let's Encrypt). Một origin cho browser; đơn giản hóa cookie/CORS/socket.

**TURN (local):** `compose.yaml` có service `coturn` (port `3478`, relay UDP `49152-49200`). Browser trên host Windows dùng `VITE_TURN_URL=turn:localhost:3478` với credential dev (`devuser`/`devpass` trong `infra/coturn/turnserver.conf`). Staging/prod: coturn trên VM riêng, rotate credential.

## Realtime implementation review (2026-05 → 2026-06)

Contract gate:

- Realtime handshake JWT + dev token — khớp policy SYS-03 trong [`06-security.md`](06-security.md).
- **API access JWT aligned (2026-05-24):** claims `sub`, `sid`, `deviceId`, `iat`, `exp`; issuer = API Service.
- **RT membership check live (2026-06):** `ALLOW_DEV_CONVERSATION_ACCESS` đã bị xóa. Realtime gọi HTTP thật tới `GET /api/v1/internal/conversations/:id/members/:userId` với `Authorization: Bearer API_INTERNAL_TOKEN` để xác minh thành viên trước khi relay tin nhắn.
- FE auth + chat pipeline đã triển khai (FE-01..FE-19). ECDH P-256 key exchange hoạt động trong `ChatContext`.
- Blocker còn lại (đã biết): SMTP bắt buộc cho đăng ký; GET /conversations shape mismatch giữa API và FE client.

## Tiến độ hạ tầng local (System Owner)

- [x] `compose.yaml` + `compose.override.yaml` (dev bind-mount / hot reload)
- [x] Gateway nginx: `infra/nginx/nginx.dev.conf` + `infra/nginx/nginx.conf`
- [x] Dockerfiles dual-stage (`development` / `runtime`) cho 3 service
- [x] `.env.example`, `.env.prod.example`, env mẫu từng service
- [x] `README.md` boot contract + lệnh dev/prod
- [x] CI skeleton: `docker compose config` dev/prod (`.github/workflows/ci.yml`)
- [x] `docker compose up --build` pass healthcheck đủ 5 service (minimal boot scaffold)
- [ ] CD staging/prod free-tier + smoke test tự động

## Pipeline CI (cổng kiểm tra PR)

Trigger:
- pull_request to `develop` and `main`.

Jobs (mục tiêu đầy đủ):
1. `lint` — chưa có
2. `typecheck` — qua `npm run build` từng service
3. `test` — chưa có
4. `build` — **có** (`build-api`, `build-realtime`, `build-frontend`)
5. `security-scan-lite` — **có** (`security-audit`, `continue-on-error` giai đoạn đầu)

Hiện tại trong repo:

- [x] `compose-validate-dev` / `compose-validate-prod`
- [x] `build-api`, `build-realtime`, `build-frontend` (api includes `npm test`)
- [x] `compose-build` (sau khi 3 build pass)
- [x] `security-audit` (lite)
- [ ] `lint`, `test` — bổ sung khi owners có script

Quy tắc:
- Tất cả kiểm tra phải pass trước khi merge.

## Pipeline CD

### Triển khai Staging

Trigger:
- merge into `develop`.

Steps:
1. Deploy API and realtime.
2. Deploy frontend.
3. Run smoke test:
   - health endpoints.
   - socket connect.
   - basic auth and message path.

### Triển khai Production

Trigger:
- merge/tag release from `main`.

Steps:
1. Deploy API then realtime then frontend.
2. Run smoke test and quick call setup check.
3. Publish release notes with known limitations.

## Health và Readiness

- API: `/health` and `/ready`.
- Realtime: `/health` and socket handshake check endpoint.

Kiểm tra tối thiểu:
- DB connectivity (API).
- Internal API reachability (Realtime).
- TURN reachability test (scheduled check or pre-demo manual check).

## Chiến lược rollback

- Keep last known good deployment.
- Rollback order:
  1. frontend
  2. realtime
  3. api
- If DB migration is incompatible:
  - use expand/contract migration model only.

## Runbook trước demo (30 phút)

1. Verify all service health endpoints.
2. Verify login and OTP test mailbox.
3. Verify socket connect and chat send.
4. Verify voice call setup.
5. Verify video call setup with TURN fallback enabled.
6. Keep one backup scenario: audio-only fallback demo.

## Rủi ro vận hành

- Free-tier cold starts increase first-response latency.
- TURN relay bandwidth may be limited.
- Staging and prod may drift without env discipline.

Giảm thiểu:
- Warmup checks before demo.
- Environment matrix document and secret sync checklist.
- Automated smoke tests on every deploy.

