@echo off
node "%~dp0tools\forgeax-plugin-0.5.0.mjs" install %*
set "FORGEAX_INSTALL_EXIT=%ERRORLEVEL%"
echo.
if "%FORGEAX_INSTALL_EXIT%"=="0" (
  echo ForgeAX installation completed. Restart Codex to load it.
) else (
  echo Installation failed. Read the error above before retrying.
)
if "%~1"=="" pause
exit /b %FORGEAX_INSTALL_EXIT%
