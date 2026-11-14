@echo off
setlocal DisableDelayedExpansion
echo.
echo   Senyu - Game Launcher
echo.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Game.ps1" %*
set "launcher_exit=%errorlevel%"
if not "%launcher_exit%"=="0" (
    echo.
    echo   Launch failed. Read the error above before closing this window.
    pause
)
exit /b %launcher_exit%
