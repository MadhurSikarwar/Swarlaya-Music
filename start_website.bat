@echo off
setlocal
title Swaralaya Website Launcher
echo ============================================================
echo                   Starting Swaralaya
echo ============================================================
echo.

:: Run from the folder this file is in (the repository root)
cd /d "%~dp0"

:: "start_website.bat docker": the full site in Docker, with the Stem Separator
if /i "%~1"=="docker" goto docker

:: Otherwise the local server: Python 3.8+ and nothing to install. It opens the
:: browser itself, only opens it if the site is already running, and moves to
:: the next free port if another program is using 3000.
:: ("py -3" finds a Python that wasn't added to PATH, the python.org default.)
set "PY="
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>&1 && set "PY=python"
if not defined PY py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>&1 && set "PY=py -3"
if not defined PY (
    docker info >nul 2>&1 && goto docker
    echo [ERROR] Python 3.8 or newer was not found.
    echo Install it from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^)
    echo and run this file again.
    echo.
    pause
    exit /b 1
)
echo Everything works except the Stem Separator, which needs Docker Desktop:
echo for the full site run "start_website.bat docker" instead.
echo The browser opens by itself. Close this window to stop the website.
echo.
%PY% tools\dev_server.py 3000 --open
if errorlevel 1 pause
exit /b

:docker
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Desktop isn't running. Start it, wait until it says
    echo "Engine running", then run this file again.
    echo.
    pause
    exit /b 1
)
:: Open the browser as soon as the server answers its health check
:: (127.0.0.1: "localhost" tries IPv6 first, which can stall ~2 s per try)
start "" /b powershell -NoProfile -Command "for ($i = 0; $i -lt 900; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:3000/health | Out-Null; Start-Process 'http://localhost:3000'; break } catch { Start-Sleep -Seconds 2 } }"
echo Building and starting the full site with Docker. The first build downloads
echo about 2 GB and can take 10-30 minutes; later starts are quick.
echo The browser opens by itself when it's ready. Press Ctrl+C here to stop it.
echo.
docker compose up --build
if errorlevel 1 (
    echo [ERROR] docker compose stopped with an error, see the messages above.
    pause
)
