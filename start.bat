@echo off
rem Starts Print Studio and opens it in its own window. Installs and builds on first run.
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js 20.11 or newer is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (call npm install || (pause & exit /b 1))
if not exist dist\index.js (call npm run build || (pause & exit /b 1))
node web\server.mjs --open
pause
