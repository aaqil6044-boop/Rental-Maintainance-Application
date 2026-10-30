@echo off
rem Static analysis of EstateOps with SonarQube running locally in Docker.
rem Usage: sonar-scan.bat <token>     (token: SonarQube > My Account > Security > Generate, type "User" or "Project analysis")
cd /d "%~dp0"
if "%~1"=="" (echo Usage: sonar-scan.bat YOUR_TOKEN & exit /b 1)
docker version >nul 2>nul || (echo Start Docker Desktop first & exit /b 1)
docker compose -f docker-compose.sonar.yml up -d || exit /b 1
echo Waiting for SonarQube to be ready (first start takes 1-3 minutes)...
:wait
powershell -NoProfile -Command "try{ if((Invoke-RestMethod http://localhost:9000/api/system/status).status -eq 'UP'){exit 0}else{exit 1} }catch{exit 1}"
if errorlevel 1 (timeout /t 5 >nul & goto wait)
docker run --rm --network host -e SONAR_HOST_URL=http://host.docker.internal:9000 -e SONAR_TOKEN=%~1 -v "%cd%:/usr/src" sonarsource/sonar-scanner-cli
echo Done. Open http://localhost:9000/dashboard?id=estateops
