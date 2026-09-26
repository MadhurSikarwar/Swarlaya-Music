@echo off
setlocal
title Swaralaya Website Launcher
echo ============================================================
echo                   Starting Swaralaya
echo ============================================================
echo.

:: Run from the folder this file is in (the repository root)
cd /d "%~dp0"

:: Already running (e.g. a launcher left open)? Just open the browser.
:: (Checks use 127.0.0.1: "localhost" tries IPv6 first, which can stall ~2 s.)
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:3000/health | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 (
    echo The website is already running.
    start "" http://localhost:3000
    exit /b 0
)

:: Open the browser as soon as the server answers its health check
start "" /b powershell -NoProfile -Command "for ($i = 0; $i -lt 600; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:3000/health | Out-Null; Start-Process 'http://localhost:3000'; break } catch { Start-Sleep -Seconds 2 } }"

:: Full site (with the Stem Separator) when Docker Desktop is running
docker info >nul 2>&1
if %errorlevel% equ 0 goto docker

:: Otherwise the local server: everything except the Stem Separator
echo Docker isn't running, so starting the local server instead.
echo Everything works except the Stem Separator (it needs Docker Desktop).
echo.
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python 3.8 or newer was not found.
    echo Install Python from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^),
    echo or install and start Docker Desktop, then run this file again.
    echo.
    pause
    exit /b 1
)
echo Press Ctrl+C in this window to stop it.
echo.
python tools\dev_server.py 3000
if %errorlevel% neq 0 pause
exit /b %errorlevel%

:docker
echo Building and starting the server with Docker (the first build takes a while)...
echo Press Ctrl+C in this window to stop it.
echo.
docker compose up --build
if %errorlevel% neq 0 (
    echo [ERROR] docker compose exited with error code %errorlevel%.
    pause
)
