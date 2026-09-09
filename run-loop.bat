@echo off
rem qwen-api background worker: keeps the proxy alive and restarts it on crash.
rem Started hidden by start-background.vbs. Logs: logs\server.log
cd /d "%~dp0"
if not exist logs mkdir logs

:loop
if exist logs\stop.flag goto :eof
node src/server.js >> logs\server.log 2>&1
if exist logs\stop.flag goto :eof
echo [%date% %time%] server exited, restarting in 3s... >> logs\server.log
timeout /t 3 /nobreak >nul
goto loop
