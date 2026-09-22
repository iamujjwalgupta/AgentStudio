@echo off
REM ==============================================================================
REM Agent Studio — Windows Batch Launcher
REM Double-click or run from command prompt to launch Agent Studio.
REM ==============================================================================

cd /d "%~dp0"
echo ======================================================
echo   Starting Agent Studio
echo ======================================================

REM 1. Check .env file
if not exist .env (
  echo Warning: .env not found. Creating .env from .env.example...
  copy .env.example .env
  echo Please verify ANTHROPIC_API_KEY in .env before running agents.
)

REM 2. Check Docker / PostgreSQL
where docker >nul 2>nul
if %ERRORLEVEL% equ 0 (
  echo Checking 'agent-studio-db' container...
  docker ps -a --format "{{.Names}}" | findstr /R /C:"^agent-studio-db$" >nul
  if %ERRORLEVEL% equ 0 (
    docker start agent-studio-db >nul 2>nul
  ) else (
    echo Creating Postgres container...
    docker run --name agent-studio-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=agent_studio -p 5432:5432 -d postgres:16
  )
) else (
  echo Docker not found in PATH. Assuming local PostgreSQL is running on port 5432...
)

REM 3. Apply schema
echo Verifying database schema...
call npm run db:setup

REM 4. Dependencies
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
)

REM 5. Launch Web App and Scheduler
echo.
echo Launching Agent Studio Web App and Scheduler...
start "Agent Studio - Scheduler" cmd /k "npm run scheduler"
start "Agent Studio - Web App" cmd /k "npm run dev"

echo.
echo ======================================================
echo   Agent Studio is starting!
echo   Web App:   http://localhost:3000
echo   Scheduler: Running in background window
echo ======================================================
echo.
pause
