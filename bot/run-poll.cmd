@echo off
rem Wrapper the scheduled task runs. Appends output to poll.log.
cd /d "%~dp0"
echo ---- %date% %time% ---->> poll.log
node src\poll.js >> poll.log 2>&1
