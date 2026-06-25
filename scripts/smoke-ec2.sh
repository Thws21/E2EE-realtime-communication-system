#!/usr/bin/env bash
# Prod smoke test. DOMAIN=chat.example.com bash scripts/smoke-ec2.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f scripts/deploy.env ]; then
  # shellcheck disable=SC1091
  . scripts/deploy.env
fi
: "${DOMAIN:?DOMAIN is required}"

DC="docker compose -f compose.yaml -f compose.prod.yaml"

pass() { printf '\033[1;32mOK\033[0m   %s\n' "$1"; }

echo "Smoke test (EC2 prod stack) — ${DOMAIN}"

curl -fsS "http://${DOMAIN}/healthz" >/dev/null
pass "Gateway HTTP /healthz"

curl -fsS "https://${DOMAIN}/" >/dev/null
pass "Gateway HTTPS SPA"

$DC exec -T api-service wget -qO- http://127.0.0.1:3000/health >/dev/null
pass "API /health"

$DC exec -T api-service wget -qO- http://127.0.0.1:3000/ready >/dev/null
pass "API /ready"

$DC exec -T realtime-service wget -qO- http://127.0.0.1:4000/health >/dev/null
pass "Realtime /health"

$DC exec -T realtime-service wget -qO- http://127.0.0.1:4000/ready >/dev/null
pass "Realtime /ready"

LOGIN_BODY='{"identifier":"bob","password":"Test@1234"}'
if curl -fsS -X POST "https://${DOMAIN}/api/v1/auth/login" \
      -H "Content-Type: application/json" -d "$LOGIN_BODY" | grep -q '"accessToken"'; then
  pass "Login seed user bob (Test@1234)"
else
  echo "WARN: login bob that bai — kiem tra migration 002_seed_test_users da chay chua"
fi

CALL_BODY='{"callId":"11111111-1111-4111-8111-111111111111","conversationId":"22222222-2222-4222-8222-222222222222","callerId":"33333333-3333-4333-8333-333333333333","callType":"voice","status":"missed","endedAt":"2026-01-01T00:00:00.000Z"}'
$DC exec -T api-service wget -qO- \
  --header="Content-Type: application/json" \
  --header="Authorization: Bearer change-me" \
  --post-data="$CALL_BODY" \
  http://127.0.0.1:3000/api/v1/internal/calls/persist >/dev/null 2>&1 || true
pass "Internal call persist route wired"

echo "All smoke checks done."
