@echo off
rem Starts EstateOps (the only supported runtime lives in nodeapp\). Sample data; for an empty database use nodeapp\run-fresh.bat
cd /d "%~dp0nodeapp"
call start.bat
