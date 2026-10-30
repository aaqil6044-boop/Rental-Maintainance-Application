@echo off
rem Same as watch-tests.bat but runs EVERY browser test (about 70) in the visible window.
cd /d "%~dp0"
if not exist node_modules call npm install || (pause & exit /b 1)
call npx playwright install chromium || (pause & exit /b 1)
set SLOWMO=250
call npx playwright test --headed --reporter=list
call node scripts\e2e-report.js
pause
