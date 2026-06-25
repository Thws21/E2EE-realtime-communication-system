$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Copy-EnvExample {
  param([string]$ExamplePath, [string]$EnvPath)
  if ((Test-Path $ExamplePath) -and -not (Test-Path $EnvPath)) {
    Copy-Item $ExamplePath $EnvPath
    Write-Host "Created $EnvPath"
  }
}

Copy-EnvExample (Join-Path $root ".env.example") (Join-Path $root ".env")
Copy-EnvExample (Join-Path $root ".env.prod.example") (Join-Path $root ".env.prod")

$services = @("api-service", "realtime-service", "frontend")
foreach ($s in $services) {
  $dir = Join-Path $root $s
  Copy-EnvExample (Join-Path $dir ".env.example") (Join-Path $dir ".env")
}

Write-Host "Done. Edit .env files if needed before docker compose up."
