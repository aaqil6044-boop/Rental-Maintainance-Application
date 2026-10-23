@echo off
rem EstateOps - development run WITH sample data. Opens http://localhost:8080
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18+ is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules call npm install || (pause & exit /b 1)
call npm run dev
pause
