@echo off
rem Opens ONE Chrome window and walks through EstateOps like a real user. The window stays open until you press Enter.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18+ is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules call npm install || (pause & exit /b 1)
call npx playwright install chromium || (pause & exit /b 1)
call npm run watch
pause
