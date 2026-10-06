#!/usr/bin/env bash
# ==============================================================================
# Agent Studio — One-Click Startup Script
#
# Starts PostgreSQL (Docker), applies database migrations, launches Next.js,
# and starts the background scheduler daemon with clean shutdown handling.
# ==============================================================================

set -e

# Change to script directory
cd "$(dirname "$0")"

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BOLD}${BLUE}=== Starting Agent Studio ===${NC}"

# 1. Check .env file
if [ ! -f .env ]; then
  echo -e "${YELLOW}Warning: .env not found. Creating .env from .env.example...${NC}"
  cp .env.example .env
  echo -e "${YELLOW}Please verify ANTHROPIC_API_KEY in .env before running agents.${NC}"
fi

# 2. Check and start Docker / PostgreSQL
echo -e "${BLUE}[1/4] Checking PostgreSQL database...${NC}"

if command -v docker >/dev/null 2>&1; then
  # Check if docker daemon is running
  if ! docker info >/dev/null 2>&1; then
    echo -e "${YELLOW}Docker daemon is not running. Attempting to start Docker...${NC}"
    if [ "$(uname)" = "Darwin" ]; then
      open -a Docker >/dev/null 2>&1 || true
    fi
    echo "Waiting for Docker to become ready..."
    for i in {1..30}; do
      if docker info >/dev/null 2>&1; then
        echo -e "${GREEN}Docker daemon is now running.${NC}"
        break
      fi
      sleep 1
    done
  fi

  if docker info >/dev/null 2>&1; then
    if docker ps -a --format '{{.Names}}' | grep -Eq "^agent-studio-db$"; then
      if ! docker ps --format '{{.Names}}' | grep -Eq "^agent-studio-db$"; then
        echo "Starting existing 'agent-studio-db' container..."
        docker start agent-studio-db >/dev/null
      else
        echo -e "${GREEN}'agent-studio-db' container is already running.${NC}"
      fi
    else
      echo "Creating and starting new 'agent-studio-db' Postgres container on port 5432..."
      docker run --name agent-studio-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=agent_studio -p 5432:5432 -d postgres:16 >/dev/null
    fi
  else
    echo -e "${YELLOW}Could not connect to Docker. Assuming Postgres is running locally on port 5432...${NC}"
  fi
else
  echo -e "${YELLOW}Docker not found in PATH. Assuming local Postgres is running...${NC}"
fi

# 3. Check and apply database schema
echo -e "${BLUE}[2/4] Verifying database schema (npm run db:setup)...${NC}"
npm run db:setup

# 4. Check dependencies
if [ ! -d "node_modules" ]; then
  echo -e "${BLUE}[3/4] Installing dependencies...${NC}"
  npm install
else
  echo -e "${BLUE}[3/4] Dependencies verified.${NC}"
fi

# 5. Launch Web App & Scheduler
echo -e "${BLUE}[4/4] Launching Web App and Scheduler...${NC}"

# Clean shutdown handler on SIGINT (Ctrl+C) or SIGTERM
cleanup() {
  echo ""
  echo -e "${YELLOW}Stopping Agent Studio services...${NC}"
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
  fi
  if [ -n "$SCHEDULER_PID" ] && kill -0 "$SCHEDULER_PID" 2>/dev/null; then
    kill "$SCHEDULER_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  echo -e "${GREEN}Agent Studio stopped cleanly.${NC}"
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Start the web app; `npm run dev` also starts the scheduler once the app is healthy.
npm run dev &
DEV_PID=$!

echo ""
echo -e "${BOLD}${GREEN}======================================================${NC}"
echo -e "${BOLD}${GREEN}  Agent Studio is now running!${NC}"
echo -e "${BOLD}  Web App:   ${BLUE}http://localhost:3000${NC}"
echo -e "${BOLD}  Scheduler: Active (polling /api/cron every 60s)${NC}"
echo -e "${BOLD}${GREEN}======================================================${NC}"
echo -e "Press ${YELLOW}Ctrl+C${NC} in this window to stop all services."
echo ""

# Keep running until user terminates
wait "$DEV_PID"
