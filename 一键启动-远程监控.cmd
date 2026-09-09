@echo off
title opencode Remote Monitor - One-click Launcher
setlocal enabledelayedexpansion

REM ==========================================================
REM  CONFIG  -  EDIT THESE WITH YOUR OWN VALUES
REM ==========================================================
REM  Your PC Tailscale IP (phone visits http://<TAILIP>:4096)
set "TAILIP=REPLACE_WITH_YOUR_TAILSCALE_IP"
REM  Shared server port
set PORT=4096
REM  Basic auth username (default: opencode)
set "OPENCODE_SERVER_USERNAME=opencode"
REM  Basic auth password (use a strong one; never commit to a public repo)
set "OPENCODE_SERVER_PASSWORD=REPLACE_WITH_YOUR_PASSWORD"
REM ==========================================================

echo ==============================================================
echo   opencode Remote Monitor - One-click Launcher
echo ==============================================================
echo.

REM ---- 1. Check Tailscale (required for phone remote access) ----
set TS=
if exist "%ProgramFiles%\Tailscale\tailscale.exe" set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if exist "%ProgramFiles(x86)%\Tailscale\tailscale.exe" set "TS=%ProgramFiles(x86)%\Tailscale\tailscale.exe"
if defined TS (
  "%TS%" status >nul 2>&1
  if not errorlevel 1 (
    echo [1/3] Tailscale is connected. Phone can reach this PC.
  ) else (
    echo [1/3] [WARN] Tailscale is NOT connected. Phone cannot reach this PC.
  )
) else (
  echo [1/3] [WARN] Tailscale not found. Phone remote access may not work.
)
echo.

REM ---- 2. Make sure the shared server is running ----
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [2/3] Shared server already running on port %PORT%.
) else (
  echo [2/3] Starting shared server on port %PORT% ...
  start "opencode-server" /min cmd /c "set OPENCODE_SERVER_USERNAME=%OPENCODE_SERVER_USERNAME%&& set OPENCODE_SERVER_PASSWORD=%OPENCODE_SERVER_PASSWORD%&& opencode web --hostname 0.0.0.0 --port %PORT%"
)
echo.

REM ---- 3. Wait until server is ready ----
echo Waiting for server to be ready...
set /a tries=0
:wait
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 goto ready
set /a tries+=1
if !tries! GEQ 30 (
  echo [ERROR] Server did not start in time. Check opencode / port conflicts.
  goto end
)
goto wait

:ready
echo [OK] Shared server is ready!
echo.
echo   Phone access URL (from any network):
echo       http://%TAILIP%:%PORT%
echo       Username: %OPENCODE_SERVER_USERNAME%
echo       Password: %OPENCODE_SERVER_PASSWORD%
echo.
echo   Local browser:  http://127.0.0.1:%PORT%
echo.
echo ==============================================================
echo   Opening the terminal session (attach) ...
echo   Work in this window. The phone mirrors it in real time
echo   and you can also send commands from the phone.
echo ==============================================================
echo.

REM ---- 4. Enter the shared terminal session (where you work) ----
opencode attach http://127.0.0.1:%PORT% -u %OPENCODE_SERVER_USERNAME% -p %OPENCODE_SERVER_PASSWORD%
if errorlevel 1 (
  echo.
  echo [HINT] Attach session ended. If it errored, make sure "opencode" is on PATH.
)

:end
echo.
pause
