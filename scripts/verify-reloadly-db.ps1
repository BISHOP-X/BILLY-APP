param([switch]$Applied)
# Synthetic fixtures and, before installation, reviewed migration DDL are rolled back.
$ErrorActionPreference = 'Stop'
if (-not $env:CODEX_SUPABASE_TOKEN_BILLY) { throw 'Billy management access is required.' }
$root = Split-Path $PSScriptRoot -Parent
$files = @('supabase/migrations/20261110181918_optional_onboarding_pin.sql', 'supabase/migrations/20261110182211_reloadly_commerce.sql')
$parts = if (-not $Applied) { foreach ($file in $files) {
  $sql = Get-Content -Raw -LiteralPath (Join-Path $root $file)
  $sql -replace '(?im)^begin;\s*$', '' -replace '(?im)^commit;\s*$', ''
} }
$assertions = Get-Content -Raw -LiteralPath (Join-Path $root 'supabase/tests/database/commerce_assertions.sql')
$query = "begin;`n" + ($parts -join "`n") + "`n" + $assertions + "`nrollback;"
$result = Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/omsrzwwudskxpkyynnxw/database/query' `
  -Headers @{Authorization="Bearer $env:CODEX_SUPABASE_TOKEN_BILLY"} -ContentType 'application/json' -Body (@{query=$query} | ConvertTo-Json -Compress)
Write-Output 'PASS: optional onboarding PIN, one dispatch, exact debit, immutable holds, evidence-backed settlement, duplicate protection, failure release, owner isolation. All test changes rolled back.'
