@echo off
rem Double-click to play +1 Motorcycle Evolution locally: installs what's missing, builds the client,
rem starts the game server on http://localhost:2593 and opens the browser once the server answers.
rem Close this window to stop the server.
setlocal
title +1 Motorcycle Evolution - local server
cd /d "%~dp0"
set PORT=2593

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed. Install Node 20 or newer from https://nodejs.org and try again.
    goto :fail
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 20 ? 1 : 0)"
if errorlevel 1 (
    echo This game needs Node 20 or newer. You have:
    node -v
    goto :fail
)

netstat -ano | findstr /c:":%PORT% " | findstr LISTENING >nul
if not errorlevel 1 (
    rem Already running? Only reopen it if that server is serving this game
    powershell -NoProfile -Command "try { if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:%PORT%/).Content -match 'Motorcycle Evolution') { exit 0 } } catch {}; exit 1"
    if errorlevel 1 (
        echo Port %PORT% is used by another program. Close it ^(or change PORT in this file^) and try again.
        goto :fail
    )
    echo The game is already running - opening http://localhost:%PORT% ...
    start "" http://localhost:%PORT%
    goto :end
)

if not exist "server\node_modules" call npm install || goto :fail
if not exist "client\node_modules" call npm install || goto :fail
echo Building the game...
call npm run build || goto :fail

rem Open the browser as soon as the server is up (polls /health for up to 30 s)
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:%PORT%/health | Out-Null; Start-Process 'http://localhost:%PORT%'; break } catch { Start-Sleep -Milliseconds 500 } }"

echo Starting the server on http://localhost:%PORT% ...
call npm start
echo.
echo The server stopped.
goto :end

:fail
echo.
echo Could not start the game. See the messages above.
:end
pause
