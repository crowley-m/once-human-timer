@echo off
rem Runs the timer API and restarts it if it ever exits. Launched at logon.
cd /d "%~dp0"
if not defined PORT set PORT=3002
:loop
echo ---- %date% %time%  starting (port %PORT%) ---->> server.log
node src\index.js >> server.log 2>&1
echo ---- %date% %time%  exited, restarting in 5s ---->> server.log
ping -n 6 127.0.0.1 >nul
goto loop
