param([switch]$Check)
$ErrorActionPreference = 'Stop'
$env:PATH = 'D:\tiangong-tools\pnpm-12.10.1\node_modules\.bin;' + $env:PATH
$env:PNPM_HOME = 'D:\tiangong-tools\pnpm-home'
$env:COREPACK_HOME = 'D:\tiangong-tools\corepack'
$env:XDG_CACHE_HOME = 'D:\tiangong-tools\cache'
$env:npm_config_cache = 'D:\tiangong-tools\npm-cache'
$env:TEMP = Join-Path $PSScriptRoot 'game\.tmp-tests'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
Push-Location (Join-Path $PSScriptRoot 'game')
try {
  if ($Check) { pnpm exec forgeax project check --json }
  else { pnpm exec forgeax dev start --headless false --json }
} finally { Pop-Location }
