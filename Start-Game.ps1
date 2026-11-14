param([switch]$Check)
$ErrorActionPreference = 'Stop'

# ============================================================
#  天工开发预览启动脚本（跨机器自适应）
#
#  这个文件之前把工具链路径写死成 D:\tiangong-tools，
#  只有装了该目录的机器能跑，其他人拉取后直接报错。
#
#  现在改成三段探测：
#    1. node / pnpm：先用系统里已有的，没有再退回 WorkBuddy 私有 node
#    2. 工具缓存：有 D:\tiangong-tools 就用（团队约定，省 C 盘 + 复用缓存），
#       没有就跳过——功能完全一样，只是首次装依赖会重新下载
#    3. 临时目录：始终放工程内，避免污染系统 TEMP
#
#  任何一台机器拉下来都能直接跑，不需要手改本文件。
# ============================================================

# ---------- 1. 定位 node ----------

function Resolve-NodeRoot {
    # 系统 PATH 里已经有 node 就用它（团队机器可能装在别处）
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return Split-Path $cmd.Source -Parent }

    # 退回 WorkBuddy 自带的私有 node
    $versions = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions'
    if (-not (Test-Path $versions)) { return $null }

    # current 是纯文本，权威值写在这里（版本目录名会随客户端更新变化）
    $currentFile = Join-Path $versions 'current'
    if (Test-Path $currentFile) {
        $name = (Get-Content $currentFile -Raw).Trim()
        $dir = Join-Path $versions $name
        if (Test-Path (Join-Path $dir 'node.exe')) { return $dir }
    }

    # 兜底：取版本号最大的那个
    $latest = Get-ChildItem $versions -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d+\.' } |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if ($latest) { return $latest.FullName }

    return $null
}

$nodeRoot = Resolve-NodeRoot
if ($nodeRoot) { $env:PATH = "$nodeRoot;$env:PATH" }

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
    Write-Host ""
    Write-Host "找不到 node 或 pnpm。" -ForegroundColor Red
    Write-Host "请先装 Node.js 22.13 或更高版本；" -ForegroundColor Yellow
    Write-Host "或者用 WorkBuddy 客户端打开过一次会话（它会带上私有 node）。" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# ---------- 2. 工具缓存目录（可选） ----------
# 团队约定把所有缓存放 D:\tiangong-tools，避免占满 C 盘、也方便多工程复用。
# 没有这个目录就跳过：pnpm 用系统默认位置，运行效果完全一样。

$toolsRoot = 'D:\tiangong-tools'
if (Test-Path $toolsRoot) {
    $env:PNPM_HOME        = Join-Path $toolsRoot 'pnpm-home'
    $env:COREPACK_HOME    = Join-Path $toolsRoot 'corepack'
    $env:XDG_CACHE_HOME   = Join-Path $toolsRoot 'cache'
    $env:npm_config_cache = Join-Path $toolsRoot 'npm-cache'
    Write-Host "工具缓存: $toolsRoot" -ForegroundColor DarkGray
} else {
    Write-Host "工具缓存: 未配置，使用系统默认（不影响运行）" -ForegroundColor DarkGray
}

# ---------- 3. 临时目录放工程内 ----------
# 测试可能产生大量临时文件，放工程里比塞系统 TEMP 干净，也方便清理。

$env:TEMP = Join-Path $PSScriptRoot 'game\.tmp-tests'
$env:TMP  = $env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null

# ---------- 4. 跑起来 ----------

Write-Host "node: $nodeRoot" -ForegroundColor DarkGray
Write-Host "工程: $(Join-Path $PSScriptRoot 'game')" -ForegroundColor DarkGray

Push-Location (Join-Path $PSScriptRoot 'game')
try {
    if ($Check) { pnpm exec forgeax project check --json }
    else { pnpm exec forgeax dev start --headless false --json }
} finally {
    Pop-Location
}
