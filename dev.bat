@echo off
REM dev.bat — start the dev server detached so it survives the harness reaper
cd /d "%~dp0"
call npm run dev:keepalive
pause
