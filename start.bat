@echo off
chcp 65001 >nul
title qwen-api
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [qwen-api] Node.js not found. Install the LTS version from https://nodejs.org first.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [qwen-api] first run - installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [qwen-api] dependency install failed. Check your network and retry.
    pause
    exit /b 1
  )
)

node src/server.js
pause
