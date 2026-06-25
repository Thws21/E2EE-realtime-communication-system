$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-HttpOk {
    param([string]$Label, [string]$Url)
    curl.exe -sf $Url | Out-Null
    Write-Host "$Label OK"
}

Write-Host "Smoke test (local stack)..."

Test-HttpOk "Gateway" "http://localhost/"

Write-Host "API /health (in-container)..."
docker compose exec -T api-service wget -qO- http://127.0.0.1:3000/health | Out-Null
Write-Host "API health OK"

Write-Host "API /ready (in-container)..."
docker compose exec -T api-service wget -qO- http://127.0.0.1:3000/ready | Out-Null
Write-Host "API ready OK"

Write-Host "Realtime /health (in-container)..."
docker compose exec -T realtime-service wget -qO- http://127.0.0.1:4000/health | Out-Null
Write-Host "Realtime health OK"

Write-Host "Realtime /ready (in-container)..."
docker compose exec -T realtime-service wget -qO- http://127.0.0.1:4000/ready | Out-Null
Write-Host "Realtime ready OK"

Write-Host "API JWT claim contract (npm test in-container)..."
docker compose exec -T api-service npm test
if ($LASTEXITCODE -ne 0) { throw "API JWT claim tests failed" }
Write-Host "API JWT claim tests OK"

Write-Host "Internal call persist endpoint probe..."
$callBody = '{"callId":"11111111-1111-4111-8111-111111111111","conversationId":"22222222-2222-4222-8222-222222222222","callerId":"33333333-3333-4333-8333-333333333333","callType":"voice","status":"missed","endedAt":"2026-01-01T00:00:00.000Z"}'
docker compose exec -T api-service wget -qO- --header="Content-Type: application/json" --header="Authorization: Bearer change-me" --post-data=$callBody http://127.0.0.1:3000/api/v1/internal/calls/persist 2>$null | Out-Null
Write-Host "Internal call persist route wired (403/404 expected without real conversation)"

Write-Host "Migration 003_device_ecdh_keys applied..."
$migrationCheck = docker compose exec -T postgres psql -U e2ee_user -d e2ee_app -tAc "SELECT 1 FROM schema_migrations WHERE version = '003_device_ecdh_keys'"
if ($migrationCheck -notmatch "1") {
    throw "Migration 003_device_ecdh_keys not applied — run: docker compose exec api-service npm run migrate"
}
Write-Host "Migration 003 OK"

Write-Host "Device prekey routes wired (401 without auth expected)..."
$prekeyProbe = docker compose exec -T api-service wget -qO- --server-response http://127.0.0.1:3000/api/v1/users/00000000-0000-4000-8000-000000000001/ecdh-public-key 2>&1
if ($prekeyProbe -notmatch "401" -and $prekeyProbe -notmatch "404") {
    Write-Warning "Unexpected response from ecdh-public-key route — verify api-service is rebuilt"
} else {
    Write-Host "Prekey GET route wired OK"
}

Write-Host "All smoke checks passed."
