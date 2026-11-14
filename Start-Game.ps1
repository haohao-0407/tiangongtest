<#
.SYNOPSIS
启动森屿，或检查、修复、重启、停止本工程的开发预览。
.DESCRIPTION
需要 Node.js 22.13 或更新版本。自动探测本机安装，不依赖固定盘符。
也可通过 -NodePath 或 GAME_NODE_PATH 指定 node.exe。
依赖安装、日志和会话管理交给 tools/game-launcher.mjs。
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Restart,
    [switch]$Stop,
    [switch]$Repair,
    [switch]$NoBrowser,
    [ValidateRange(30, 1800)]
    [int]$TimeoutSeconds = 180,
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Get-NodeCandidates {
    # 显式配置出错时应清楚报错，不能悄悄换成另一套工具链。
    if ($NodePath) { return $NodePath }
    if ($env:GAME_NODE_PATH) { return $env:GAME_NODE_PATH }

    Get-Command node.exe -All -CommandType Application -ErrorAction SilentlyContinue |
        ForEach-Object { $_.Source }

    foreach ($base in @($env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'), $env:LOCALAPPDATA)) {
        if ($base) {
            Join-Path $base 'nodejs\node.exe'
            Join-Path $base 'Programs\nodejs\node.exe'
        }
    }
    if ($env:NVM_SYMLINK) { Join-Path $env:NVM_SYMLINK 'node.exe' }
    if ($env:VOLTA_HOME) { Join-Path $env:VOLTA_HOME 'bin\node.exe' }

    if ($env:USERPROFILE) {
        $versionsRoot = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions'
        $currentFile = Join-Path $versionsRoot 'current'
        if (Test-Path -LiteralPath $currentFile -PathType Leaf) {
            try {
                $currentName = ([IO.File]::ReadAllText($currentFile)).Trim()
                if ($currentName -and $currentName -eq [IO.Path]::GetFileName($currentName)) {
                    Join-Path (Join-Path $versionsRoot $currentName) 'node.exe'
                }
            } catch { Write-Verbose "无法读取可选的 WorkBuddy current 文件：$($_.Exception.Message)" }
        }
        if (Test-Path -LiteralPath $versionsRoot -PathType Container) {
            Get-ChildItem -LiteralPath $versionsRoot -Directory -ErrorAction SilentlyContinue |
                ForEach-Object {
                    if ($_.Name -match '^v?(\d+\.\d+\.\d+)(?:[-+].*)?$') {
                        [PSCustomObject]@{ Version = [version]$Matches[1]; Directory = $_.FullName }
                    }
                } |
                Sort-Object Version -Descending |
                ForEach-Object { Join-Path $_.Directory 'node.exe' }
        }
    }
}

function Resolve-Node {
    $seen = @{}
    $failures = New-Object 'System.Collections.Generic.List[string]'
    foreach ($candidate in @(Get-NodeCandidates)) {
        if (-not $candidate) { continue }
        $candidate = [Environment]::ExpandEnvironmentVariables($candidate)
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            $candidate = Join-Path $candidate 'node.exe'
        }
        if ($seen.ContainsKey($candidate)) { continue }
        $seen[$candidate] = $true
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            if ($NodePath -or $env:GAME_NODE_PATH) { $failures.Add("指定路径不存在：$candidate") }
            continue
        }

        $probe = $null
        try {
            $candidate = (Get-Item -LiteralPath $candidate).FullName
            $startInfo = New-Object System.Diagnostics.ProcessStartInfo
            $startInfo.FileName = $candidate
            $startInfo.Arguments = '--version'
            $startInfo.UseShellExecute = $false
            $startInfo.CreateNoWindow = $true
            $startInfo.RedirectStandardOutput = $true
            $startInfo.RedirectStandardError = $true
            $probe = New-Object System.Diagnostics.Process
            $probe.StartInfo = $startInfo
            [void]$probe.Start()
            $versionOutput = $probe.StandardOutput.ReadToEndAsync()
            $errorOutput = $probe.StandardError.ReadToEndAsync()
            if (-not $probe.WaitForExit(5000)) {
                $probe.Kill()
                $probe.WaitForExit()
                throw '读取 Node.js 版本超时（5 秒）。'
            }
            $versionText = $versionOutput.Result.Trim()
            if ($probe.ExitCode -ne 0 -or $versionText -notmatch '^v?(\d+\.\d+\.\d+)$') {
                throw "无法识别 Node.js 版本：$versionText $($errorOutput.Result.Trim())"
            }
            $nodeVersion = [version]$Matches[1]
            if ($nodeVersion -lt [version]'22.13.0') {
                throw "版本 $nodeVersion 过旧，最低需要 22.13.0。"
            }
            return [PSCustomObject]@{ Path = $candidate; Version = $nodeVersion }
        } catch {
            $failures.Add("$candidate - $($_.Exception.Message)")
        } finally {
            if ($probe) { $probe.Dispose() }
        }
    }
    $detail = if ($failures.Count) { [Environment]::NewLine + ($failures -join [Environment]::NewLine) } else { '' }
    throw "找不到可用的 Node.js 22.13 或更新版本。请安装 Node.js LTS，或使用 -NodePath 指定 node.exe。$detail"
}

try {
    $node = Resolve-Node
    $launcher = Join-Path $PSScriptRoot 'tools\game-launcher.mjs'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
        throw "启动文件缺失：$launcher。请重新拉取完整工程。"
    }

    # 让引擎的子进程也使用刚验证过的 Node；不改写系统 PATH 或用户设置。
    $env:PATH = (Split-Path -Path $node.Path -Parent) + [IO.Path]::PathSeparator + $env:PATH
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $OutputEncoding = [Console]::OutputEncoding

    $launcherArguments = @($launcher, '--root', $PSScriptRoot, '--timeout-seconds', [string]$TimeoutSeconds)
    if ($Check) { $launcherArguments += '--check' }
    if ($Restart) { $launcherArguments += '--restart' }
    if ($Stop) { $launcherArguments += '--stop' }
    if ($Repair) { $launcherArguments += '--repair' }
    if ($NoBrowser) { $launcherArguments += '--no-browser' }

    & $node.Path @launcherArguments
    exit $LASTEXITCODE
} catch {
    Write-Host "启动器错误：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
