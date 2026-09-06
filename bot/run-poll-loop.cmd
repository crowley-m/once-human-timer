@echo off
rem Poor-man's scheduler: run the Discord poll every 5 minutes. Launched at logon.
rem (No admin needed, unlike Task Scheduler. If you can run register-task.ps1 as
rem  admin, that's tidier — use one or the other, not both.)
cd /d "%~dp0"
:loop
echo ---- %date% %time% ---->> poll.log
node src\poll.js >> poll.log 2>&1
ping -n 301 127.0.0.1 >nul
goto loop
