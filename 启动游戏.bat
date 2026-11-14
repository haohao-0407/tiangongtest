@echo off
cd /d "%~dp0"
echo.
echo   ForgeAX Dev Preview
echo   ----------------------------
echo   The browser window will open automatically.
echo   Close THIS window to stop the game.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Game.ps1"
pause
