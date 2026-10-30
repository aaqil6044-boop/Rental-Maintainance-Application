@echo off
rem Watch the EstateOps integration tests run live in a visible Chrome window. Double-click this file.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18+ is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules call npm install || (pause & exit /b 1)
call npx playwright install chromium || (pause & exit /b 1)
set SLOWMO=400
echo.
echo Starting the tests in a visible browser. Do not click inside the browser window while it runs.
call npx playwright test e2e/full-journey.spec.js e2e/maintenance-workflow.spec.js --headed --reporter=list
call node scripts\e2e-report.js
echo.
echo Done. Open report\EstateOps-full-integration-ui-report.html, or run: npm run e2e:report
pause
