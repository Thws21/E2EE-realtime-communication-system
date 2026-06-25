# 08 — Deploy lên AWS EC2 (free tier) cho demo

Hướng dẫn dựng toàn bộ hệ thống E2EE (chat + voice/video call) trên **một EC2 free tier** với HTTPS theo domain. Mục tiêu: demo cho giáo viên với cả tài khoản tạo sẵn và đăng ký OTP qua email.

Kiến trúc giữ nguyên mô hình một origin qua gateway nginx:

```
Browser (HTTPS) ──┬─ /            → gateway nginx → static SPA (frontend/dist)
                  ├─ /api/v1/*    → api-service:3000
                  └─ /socket.io/* → realtime-service:4000
                          │
WebRTC media ──────────── coturn :3478 (TURN/STUN)
api-service → postgres:5432 (loopback, không public)
realtime-service → api-service (internal persist)
```

---

## 1. Yêu cầu trước khi bắt đầu

- Tài khoản AWS (free tier 12 tháng).
- **Domain** trỏ về EC2 (bắt buộc cho HTTPS — trình duyệt chỉ cho dùng mic/camera trên `https://` hoặc `localhost`).
- **Gmail App Password** (hoặc SMTP khác) nếu muốn demo đăng ký OTP. Tài khoản Gmail bật 2FA → tạo App Password 16 ký tự.

---

## 2. Tạo EC2 instance

| Mục | Giá trị khuyến nghị |
|-----|---------------------|
| AMI | Ubuntu Server 22.04 LTS |
| Instance type | `t3.micro` (free tier) |
| Storage | 20–30 GiB gp3 |
| Elastic IP | **Gắn 1 Elastic IP** rồi trỏ A record của domain về IP này (tránh đổi IP làm hỏng DNS/TURN) |

t3.micro chỉ có ~1 GiB RAM. Script deploy tự tạo **2 GiB swap** để build và chạy đủ container.

### Security Group (inbound)

| Port | Protocol | Mục đích |
|------|----------|----------|
| 22 | TCP | SSH (giới hạn IP của bạn) |
| 80 | TCP | HTTP redirect + cấp/gia hạn cert |
| 443 | TCP | HTTPS app |
| 3478 | TCP + UDP | TURN |
| 49152–49200 | UDP | TURN relay |

**Không** mở 5432 / 3000 / 4000 ra internet. Postgres đã bind loopback nên kể cả mở cũng không truy cập được từ ngoài.

---

## 3. Cấu hình DNS

Tạo bản ghi **A**: `chat.example.com → <Elastic IP>`. Đợi DNS phân giải (kiểm tra `nslookup chat.example.com`) trước khi cấp cert.

---

## 4. Chuẩn bị mã nguồn và secrets trên server

```bash
ssh ubuntu@<elastic-ip>
git clone <repo-url> e2ee && cd e2ee
```

Tạo 5 file cấu hình từ template và điền **giá trị thật**:

```bash
cp .env.prod.example .env.prod
cp api-service/.env.example api-service/.env
cp realtime-service/.env.example realtime-service/.env
cp frontend/.env.example frontend/.env
cp scripts/deploy.env.example scripts/deploy.env
```

### Bảng biến bắt buộc

| File | Biến | Giá trị prod |
|------|------|--------------|
| `.env.prod` | `BUILD_TARGET` | `runtime` |
| | `NGINX_CONF` | `nginx.ssl.conf` |
| | `POSTGRES_PASSWORD` | mật khẩu mạnh |
| `api-service/.env` | `NODE_ENV` | `production` |
| | `DATABASE_URL` | `postgresql://e2ee_user:<POSTGRES_PASSWORD>@postgres:5432/e2ee_app` |
| | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `API_INTERNAL_TOKEN` | random mạnh |
| | `CORS_ALLOWED_ORIGINS` | `https://chat.example.com` |
| | `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | thông tin SMTP thật (xem §7) |
| `realtime-service/.env` | `NODE_ENV` | `production` |
| | `SOCKET_CORS_ORIGINS` | `https://chat.example.com` |
| | `JWT_ACCESS_SECRET`, `API_INTERNAL_TOKEN` | **khớp** với api-service |
| | `ALLOW_DEV_MESSAGE_PERSIST` | `false` (persist thật — xem ghi chú dưới) |
| `frontend/.env` | `VITE_API_BASE_URL` | `/api/v1` |
| | `VITE_SOCKET_BASE_URL` | để trống |
| | `VITE_TURN_URL` | `turn:chat.example.com:3478` |
| | `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | **khớp** `TURN_USER` / `TURN_PASS` |
| `scripts/deploy.env` | `DOMAIN`, `CERTBOT_EMAIL`, `TURN_USER`, `TURN_PASS` | điền thật |

> Ghi chú quan trọng: `ALLOW_DEV_MESSAGE_PERSIST=false` nghĩa là **persist thật** vào DB. Tên flag dễ gây hiểu nhầm: `true` = bỏ qua ghi DB (chỉ dành cho dev test). Khi `NODE_ENV=production` hệ thống cũng tự ép persist thật.

`JWT_ACCESS_SECRET` và `API_INTERNAL_TOKEN` **phải giống nhau** giữa `api-service/.env` và `realtime-service/.env`, nếu không socket auth và internal persist sẽ fail.

---

## 5. Deploy một lệnh

```bash
bash scripts/deploy-ec2.sh
```

Script làm tuần tự (idempotent — chạy lại an toàn):

1. Cài Docker + compose plugin nếu thiếu.
2. Tạo 2 GiB swap.
3. Render `infra/nginx/nginx.ssl.conf` từ template theo domain.
4. Render `infra/coturn/turnserver.conf` với `external-ip` = Elastic IP và credential mạnh.
5. Cấp TLS cert Let's Encrypt (certbot standalone, cần port 80 trống).
6. Build `frontend/dist` (Vite đọc `frontend/.env`).
7. `docker compose -f compose.yaml -f compose.prod.yaml --env-file .env.prod up -d --build`.
8. Verify `http://<domain>/healthz` và `https://<domain>/`.

API tự chạy migration lúc khởi động (entrypoint `scripts/docker-entrypoint.sh`), gồm cả seed user demo.

---

## 6. Tài khoản demo (seed sẵn)

Migration `api-service/migrations/002_seed_test_users.sql` tạo sẵn 5 user, mật khẩu chung `Test@1234`:

| Đăng nhập (username hoặc email) | Mật khẩu |
|--------------------------------|----------|
| `alice` / `alice@test.local` | `Test@1234` |
| `bob` / `bob@test.local` | `Test@1234` |
| `charlie`, `diana`, `eve` | `Test@1234` |

Đăng nhập 2 trình duyệt khác nhau (vd Bob và Alice) để demo chat + call hai chiều.

---

## 7. Demo đăng ký OTP qua email (SMTP)

Đăng ký user mới cần SMTP thật. Với Gmail:

1. Bật 2FA cho tài khoản Gmail.
2. Tạo **App Password** (16 ký tự).
3. Điền vào `api-service/.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-account@gmail.com
SMTP_PASS=<app-password-16-ky-tu>
SMTP_FROM=your-account@gmail.com
```

4. Khởi động lại api-service: `docker compose -f compose.yaml -f compose.prod.yaml restart api-service`.

Nếu SMTP để trống, endpoint xin OTP sẽ báo lỗi — lúc đó chỉ demo được bằng user seed sẵn.

---

## 8. Kiểm tra sau deploy

```bash
bash scripts/smoke-ec2.sh
```

Kiểm tra gateway HTTP/HTTPS, health/ready của api + realtime, đăng nhập user seed `bob`, và route internal call persist.

---

## 9. Checklist 30 phút trước demo

- [ ] `https://<domain>/` mở được, đăng nhập `bob` / `Test@1234`.
- [ ] Chat Bob ↔ Alice, **reload trang vẫn còn tin** (persist OK).
- [ ] Voice: Accept → nghe hai chiều trong ~5s.
- [ ] Video: có hình + tiếng; tắt cam không bị cúp máy.
- [ ] Cuộc gọi nhỡ / từ chối → hiện dòng lịch sử trong timeline; reload vẫn còn.
- [ ] Đăng ký user mới + nhận OTP (nếu bật SMTP).
- [ ] `bash scripts/smoke-ec2.sh` pass.
- [ ] `docker stats` — RAM còn dư, swap không cạn.

---

## 10. Troubleshooting

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|-------------|------------------------|------------|
| Call kết nối nhưng không có tiếng/hình | TURN chưa hoạt động / UDP bị chặn | Kiểm tra SG mở 3478 + 49152–49200 UDP; `external-ip` đúng Elastic IP; demo cùng WiFi trước |
| Gateway không start | Cert chưa có khi nginx load `nginx.ssl.conf` | Đảm bảo bước certbot ở §5 chạy thành công trước khi `up` |
| Đăng nhập seed fail | Migration chưa chạy | Xem log `docker compose ... logs api-service`; entrypoint phải in "Running database migrations" |
| Build OOM trên t3.micro | RAM cạn | Đảm bảo swap 2G đang bật (`swapon --show`) |
| Cert hết hạn | Chưa renew | `certbot renew` (standalone cần tạm dừng gateway, hoặc dùng webroot `/var/www/certbot`) rồi `docker compose ... restart gateway` |

Tham khảo thêm runbook và secrets matrix trong [`07-deployment-cicd.md`](07-deployment-cicd.md).
