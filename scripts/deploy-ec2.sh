#!/usr/bin/env bash
# Idempotent EC2 deploy. Config: scripts/deploy.env (see deploy.env.example).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f scripts/deploy.env ]; then
  # shellcheck disable=SC1091
  . scripts/deploy.env
fi

: "${DOMAIN:?DOMAIN is required (vd: chat.example.com)}"
: "${CERTBOT_EMAIL:?CERTBOT_EMAIL is required}"
: "${TURN_USER:?TURN_USER is required}"
: "${TURN_PASS:?TURN_PASS is required}"
PUBLIC_IP="${PUBLIC_IP:-$(curl -fsS http://checkip.amazonaws.com || true)}"
: "${PUBLIC_IP:?Khong detect duoc PUBLIC_IP — hay set thu cong}"

log() { printf '\n\033[1;36m[deploy]\033[0m %s\n' "$1"; }

log "1/8 Cai Docker + compose plugin (neu thieu)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
fi
if ! docker compose version >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y docker-compose-plugin
fi

log "2/8 Tao swap 2G (t3.micro chi ~1G RAM)"
if ! sudo swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

log "3/8 Render nginx.ssl.conf cho domain ${DOMAIN}"
sed "s/__DOMAIN__/${DOMAIN}/g" infra/nginx/nginx.ssl.conf.template > infra/nginx/nginx.ssl.conf

log "4/8 Render coturn turnserver.conf (external-ip ${PUBLIC_IP})"
sed -e "s/__EXTERNAL_IP__/${PUBLIC_IP}/g" \
    -e "s/__REALM__/${DOMAIN}/g" \
    -e "s/__TURN_USER__/${TURN_USER}/g" \
    -e "s/__TURN_PASS__/${TURN_PASS}/g" \
    infra/coturn/turnserver.conf.template > infra/coturn/turnserver.conf

log "5/8 Lay TLS cert (Let's Encrypt) neu chua co"
sudo mkdir -p /var/www/certbot
if [ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  sudo docker run --rm -p 80:80 \
    -v /etc/letsencrypt:/etc/letsencrypt \
    -v /var/www/certbot:/var/www/certbot \
    certbot/certbot certonly --standalone \
      -d "${DOMAIN}" --email "${CERTBOT_EMAIL}" --agree-tos --non-interactive
else
  log "Cert da ton tai — bo qua issuance (renew bang certbot renew)"
fi

log "6/8 Build frontend dist (doc frontend/.env cho VITE_*)"
docker run --rm \
  -v "${REPO_ROOT}/frontend":/app -w /app \
  node:22-bookworm-slim sh -c "npm ci --include=optional && npm run build"

log "7/8 docker compose up (prod)"
docker compose -f compose.yaml -f compose.prod.yaml --env-file .env.prod up -d --build

log "8/8 Verify qua gateway"
sleep 8
curl -fsS "http://${DOMAIN}/healthz" >/dev/null && log "HTTP healthz OK"
curl -fskS "https://${DOMAIN}/" >/dev/null && log "HTTPS SPA OK"

log "Done. Mo https://${DOMAIN}/ va chay scripts/smoke-ec2.sh de kiem tra sau."
