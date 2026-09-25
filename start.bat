@echo off
setlocal

set "ROOT=%~dp0"

echo Starting B-ware...
echo.

REM Local MySQL in Docker (port 3307). Needs Docker Desktop running.
docker start bware-mysql >nul 2>&1
if errorlevel 1 (
  echo Creating MySQL container on port 3307...
  docker run -d --name bware-mysql -e MYSQL_ROOT_PASSWORD=bwaredev -e MYSQL_DATABASE=bware_ai -p 3307:3306 mysql:8.0
)

echo Waiting for MySQL...
set /a TRIES=0
:wait_mysql
set /a TRIES+=1
docker exec bware-mysql mysqladmin ping -uroot -pbwaredev --silent >nul 2>&1
if errorlevel 1 (
  if %TRIES% GEQ 30 (
    echo MySQL did not become ready. Is Docker Desktop running?
    goto after_mysql
  )
  timeout /t 2 /nobreak >nul
  goto wait_mysql
)

echo Applying schema + demo trending seed...
powershell -NoProfile -Command "Get-Content -Raw '%ROOT%database\init_local.sql' | docker exec -i bware-mysql mysql -uroot -pbwaredev"

:after_mysql
echo.
echo Tip: Redis should be running on localhost:6379
echo Tip: NLP needs torch — in nlp-service venv run: pip install torch
echo.

start "B-ware NLP" cmd /k "cd /d "%ROOT%nlp-service" && if exist ".venv\Scripts\activate.bat" call ".venv\Scripts\activate.bat" && python -m uvicorn main:app --reload --port 5001"
start "B-ware Backend" cmd /k "cd /d "%ROOT%backend" && npm run dev"
start "B-ware Frontend" cmd /k "cd /d "%ROOT%frontend" && npm run dev"

echo Opened NLP (:5001), backend (:5000), frontend (:3000).
echo MySQL: Docker bware-mysql on :3307  ^|  Redis: local :6379
endlocal
