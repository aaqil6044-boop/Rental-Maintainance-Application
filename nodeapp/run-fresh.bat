@echo off
rem EstateOps - EMPTY database. The first-run screen creates your manager account.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18+ is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules call npm install || (pause & exit /b 1)
set DATA_DIR=data-fresh
set UPLOAD_DIR=data-fresh\uploads
set NODE_ENV=development
call npm start
pause
