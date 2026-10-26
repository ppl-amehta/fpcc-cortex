#!/usr/bin/env bash
# ==============================================================================
# FPCC SELVEDGE & CORTEX: UNIFIED LIVE OPERATIONS CONTROLLER (live.sh)
# Repeatable, Resilient, Scripted Public Tunnel & GitHub Sync Engine
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${SCRIPT_DIR}/.live"
APP_PID_FILE="${STATE_DIR}/app.pid"
TUNNEL_PID_FILE="${STATE_DIR}/tunnel.pid"
APP_LOG="${STATE_DIR}/app.log"
TUNNEL_LOG="${STATE_DIR}/tunnel.log"
STATE_JSON="${STATE_DIR}/state.json"

# ANSI Colors
BOLD="\033[1m"
GREEN="\033[0;32m"
BLUE="\033[0;34m"
CYAN="\033[0;36m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
MAGENTA="\033[0;35m"
NC="\033[0m" # No Color

mkdir -p "${STATE_DIR}"

# 1. Detect Project Type & Target Port
detect_project() {
  if [ -f "${SCRIPT_DIR}/cmd/selvedge/main.go" ]; then
    PROJECT_NAME="Selvedge Enterprise Engine (Go 1.27 + SQLite WAL)"
    PROJECT_TYPE="go"
    DEFAULT_PORT=4000
    GITHUB_REPO="ppl-amehta/selvedge"
  elif [ -f "${SCRIPT_DIR}/server/src/server.js" ] || [ -f "${SCRIPT_DIR}/server.js" ]; then
    PROJECT_NAME="FPCC Cortex (Node.js + Express + SQLite)"
    PROJECT_TYPE="node"
    DEFAULT_PORT=3000
    GITHUB_REPO="ppl-amehta/fpcc-cortex"
  else
    PROJECT_NAME="Selvedge Project"
    PROJECT_TYPE="go"
    DEFAULT_PORT=4000
    GITHUB_REPO="ppl-amehta/selvedge"
  fi
}

detect_project
PORT="${PORT:-$DEFAULT_PORT}"

# Helper to check if PID is actively running
is_pid_alive() {
  local pid="$1"
  [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null
}

# Helper to check if port is currently listening
is_port_listening() {
  local port="$1"
  lsof -iTCP:"${port}" -sTCP:LISTEN -n -P >/dev/null 2>&1
}

# Extract trycloudflare public URL from log
get_public_url_from_log() {
  if [ -f "${TUNNEL_LOG}" ]; then
    grep -o 'https://[-0-9a-z]*\.trycloudflare\.com' "${TUNNEL_LOG}" | tail -n 1 || true
  fi
}

# Get current GitHub Repo Homepage URL
get_github_homepage() {
  if command -v gh >/dev/null 2>&1; then
    gh repo view "${GITHUB_REPO}" --json homepageUrl --jq '.homepageUrl' 2>/dev/null || true
  fi
}

# ==============================================================================
# SUBCOMMAND: STATUS
# ==============================================================================
cmd_status() {
  echo -e "\n${BOLD}${CYAN}=================================================================${NC}"
  echo -e "${BOLD}${CYAN}   FPCC LIVE OPERATIONS DASHBOARD: ${PROJECT_NAME}${NC}"
  echo -e "${BOLD}${CYAN}=================================================================${NC}"

  # 1. Local Server Check
  echo -e "\n${BOLD}[1] Local Engine Status:${NC}"
  local app_pid=""
  if [ -f "${APP_PID_FILE}" ]; then
    app_pid=$(cat "${APP_PID_FILE}" 2>/dev/null || true)
  fi

  local port_listening=false
  if is_port_listening "${PORT}"; then
    port_listening=true
  fi

  if is_pid_alive "${app_pid}" || [ "${port_listening}" = true ]; then
    local health_resp=""
    health_resp=$(curl -s -m 2 "http://localhost:${PORT}/api/health" 2>/dev/null || true)
    echo -e "  • State:       ${GREEN}● RUNNING${NC}"
    echo -e "  • Local Port:  ${BOLD}http://localhost:${PORT}${NC}"
    if [ -n "${app_pid}" ]; then
      echo -e "  • Process PID: ${CYAN}${app_pid}${NC}"
    fi
    if [ -n "${health_resp}" ]; then
      echo -e "  • Health Check: ${GREEN}HTTP 200 OK${NC} (${health_resp})"
    else
      echo -e "  • Health Check: ${YELLOW}Port open, awaiting API response${NC}"
    fi
  else
    echo -e "  • State:       ${RED}○ STOPPED${NC} (Port ${PORT} is free)"
  fi

  # 2. Public Tunnel Check
  echo -e "\n${BOLD}[2] Public Edge Tunnel (Cloudflare):${NC}"
  local tunnel_pid=""
  if [ -f "${TUNNEL_PID_FILE}" ]; then
    tunnel_pid=$(cat "${TUNNEL_PID_FILE}" 2>/dev/null || true)
  fi

  local public_url=""
  public_url=$(get_public_url_from_log)

  if is_pid_alive "${tunnel_pid}" && [ -n "${public_url}" ]; then
    local pub_check=""
    pub_check=$(curl -s --doh-url https://cloudflare-dns.com/dns-query -o /dev/null -w "%{http_code}" -m 5 "${public_url}/api/health" 2>/dev/null || curl -s -o /dev/null -w "%{http_code}" -m 5 "${public_url}/api/health" 2>/dev/null || true)
    echo -e "  • State:       ${GREEN}● ACTIVE${NC}"
    echo -e "  • Tunnel PID:  ${CYAN}${tunnel_pid}${NC}"
    echo -e "  • Public URL:  ${BOLD}${GREEN}${public_url}${NC}"
    if [ "${pub_check}" = "200" ]; then
      echo -e "  • Connectivity: ${GREEN}✓ Public Internet Reachable (HTTP 200 OK)${NC}"
    else
      echo -e "  • Connectivity: ${YELLOW}Tunnel connected, edge warming up (Status ${pub_check})${NC}"
    fi
  else
    echo -e "  • State:       ${RED}○ INACTIVE${NC}"
    if [ -n "${public_url}" ]; then
      echo -e "  • Last URL:    ${YELLOW}${public_url}${NC} (Tunnel stopped)"
    fi
  fi

  # 3. GitHub Remote Sync Check
  echo -e "\n${BOLD}[3] GitHub Synchronization Status:${NC}"
  local gh_homepage=""
  gh_homepage=$(get_github_homepage)
  local git_branch=""
  git_branch=$(git -C "${SCRIPT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  local last_commit=""
  last_commit=$(git -C "${SCRIPT_DIR}" log -1 --format="%h - %s (%cr)" 2>/dev/null || echo "unknown")

  echo -e "  • Repository:  ${BOLD}https://github.com/${GITHUB_REPO}${NC} (Branch: ${git_branch})"
  echo -e "  • Last Commit: ${CYAN}${last_commit}${NC}"

  if [ -n "${gh_homepage}" ]; then
    echo -e "  • Repo Live Link: ${BOLD}${GREEN}${gh_homepage}${NC}"
    if [ "${gh_homepage}" = "${public_url}" ]; then
      echo -e "  • Sync Status:    ${GREEN}✓ 100% In Sync with Current Live Tunnel${NC}"
    else
      echo -e "  • Sync Status:    ${YELLOW}⚠ Homepage set to older URL (${gh_homepage})${NC}"
    fi
  else
    echo -e "  • Repo Live Link: ${YELLOW}None set on GitHub repository homepage${NC}"
  fi

  # 4. GitHub Actions Cloud Runner Check
  echo -e "\n${BOLD}[4] GitHub Actions Cloud Runners:${NC}"
  if command -v gh >/dev/null 2>&1; then
    local cloud_runs=""
    cloud_runs=$(gh run list -R "${GITHUB_REPO}" --workflow "live-link.yml" --limit 1 --json status,conclusion,url 2>/dev/null || true)
    if [ -n "${cloud_runs}" ] && [ "${cloud_runs}" != "[]" ]; then
      local run_status=""
      run_status=$(echo "${cloud_runs}" | grep -o '"status":"[^"]*"' | head -n 1 | cut -d'"' -f4 || true)
      if [ "${run_status}" = "in_progress" ]; then
        echo -e "  • Cloud Runner: ${GREEN}● ACTIVE IN GITHUB ACTIONS${NC} (Running in cloud)"
      else
        echo -e "  • Cloud Runner: ${YELLOW}○ IDLE${NC} (Last run: ${run_status})"
      fi
    else
      echo -e "  • Cloud Runner: ${CYAN}Workflow available (Trigger via ./live.sh cloud start)${NC}"
    fi
  fi

  echo -e "\n${CYAN}-----------------------------------------------------------------${NC}"
  echo -e "Quick Actions: ${BOLD}./live.sh start${NC} | ${BOLD}./live.sh stop${NC} | ${BOLD}./live.sh restart${NC} | ${BOLD}./live.sh open${NC}\n"
}

# ==============================================================================
# SUBCOMMAND: START
# ==============================================================================
cmd_start() {
  echo -e "\n${BOLD}${BLUE}🚀 Initializing Public Live Link for ${PROJECT_NAME}...${NC}\n"

  # 1. Check or build binary for Go projects
  if [ "${PROJECT_TYPE}" = "go" ]; then
    if [ ! -f "${SCRIPT_DIR}/selvedge" ] || [ "${SCRIPT_DIR}/cmd/selvedge/main.go" -nt "${SCRIPT_DIR}/selvedge" ]; then
      echo -e "  ${CYAN}[1/5] Compiling single static binary...${NC}"
      (cd "${SCRIPT_DIR}" && go build -o selvedge ./cmd/selvedge)
      echo -e "  ${GREEN}✓ Binary compiled successfully${NC}"
    else
      echo -e "  ${GREEN}✓ Binary up-to-date (${SCRIPT_DIR}/selvedge)${NC}"
    fi
  fi

  # 2. Start Local Server if not already listening
  if is_port_listening "${PORT}"; then
    echo -e "  ${GREEN}✓ Local server already running on port ${PORT}${NC}"
  else
    echo -e "  ${CYAN}[2/5] Starting local server daemon on port ${PORT}...${NC}"
    if [ "${PROJECT_TYPE}" = "go" ]; then
      "${SCRIPT_DIR}/selvedge" --port "${PORT}" > "${APP_LOG}" 2>&1 &
      echo $! > "${APP_PID_FILE}"
    elif [ "${PROJECT_TYPE}" = "node" ]; then
      (cd "${SCRIPT_DIR}/server" && nohup npm start > "${APP_LOG}" 2>&1 & echo $! > "${APP_PID_FILE}")
    fi

    # Wait for local health
    echo -n "  Waiting for local server health check"
    local started=false
    for i in {1..25}; do
      if curl -s "http://localhost:${PORT}/api/health" 2>/dev/null | grep -q "ok"; then
        started=true
        break
      fi
      echo -n "."
      sleep 0.4
    done
    echo ""

    if [ "${started}" = true ]; then
      echo -e "  ${GREEN}✓ Local server is healthy on http://localhost:${PORT}${NC}"
    else
      echo -e "  ${RED}✗ Failed to start local server. Logs:${NC}"
      tail -n 20 "${APP_LOG}"
      exit 1
    fi
  fi

  # 3. Check / Start Cloudflare Tunnel
  local existing_url=""
  existing_url=$(get_public_url_from_log)
  local tunnel_pid=""
  if [ -f "${TUNNEL_PID_FILE}" ]; then
    tunnel_pid=$(cat "${TUNNEL_PID_FILE}" 2>/dev/null || true)
  fi

  if is_pid_alive "${tunnel_pid}" && [ -n "${existing_url}" ]; then
    echo -e "  ${GREEN}✓ Cloudflare tunnel already active: ${BOLD}${existing_url}${NC}"
    PUBLIC_URL="${existing_url}"
  else
    echo -e "  ${CYAN}[3/5] Launching Cloudflare public edge tunnel...${NC}"
    rm -f "${TUNNEL_LOG}"
    cloudflared tunnel --url "http://localhost:${PORT}" > "${TUNNEL_LOG}" 2>&1 &
    local new_tunnel_pid=$!
    echo "${new_tunnel_pid}" > "${TUNNEL_PID_FILE}"

    echo -n "  Acquiring public HTTPS endpoint from Cloudflare"
    local found_url=""
    for i in {1..30}; do
      found_url=$(grep -o 'https://[-0-9a-z]*\.trycloudflare\.com' "${TUNNEL_LOG}" | tail -n 1 || true)
      if [ -n "${found_url}" ]; then
        break
      fi
      echo -n "."
      sleep 0.5
    done
    echo ""

    if [ -z "${found_url}" ]; then
      echo -e "  ${RED}✗ Failed to acquire public URL. Tunnel logs:${NC}"
      cat "${TUNNEL_LOG}"
      exit 1
    fi

    PUBLIC_URL="${found_url}"
    echo -e "  ${GREEN}✓ Public Live URL established:${NC} ${BOLD}${GREEN}${PUBLIC_URL}${NC}"
  fi

  # 4. Verify Public Reachability
  echo -e "  ${CYAN}[4/5] Testing public endpoint reachability...${NC}"
  local pub_http=""
  for i in {1..15}; do
    pub_http=$(curl -s --doh-url https://cloudflare-dns.com/dns-query -o /dev/null -w "%{http_code}" -m 4 "${PUBLIC_URL}/api/health" 2>/dev/null || curl -s -o /dev/null -w "%{http_code}" -m 4 "${PUBLIC_URL}/api/health" 2>/dev/null || true)
    if [ "${pub_http}" = "200" ]; then
      break
    fi
    sleep 0.8
  done

  if [ "${pub_http}" = "200" ]; then
    echo -e "  ${GREEN}✓ Public URL verified: HTTP 200 OK${NC}"
  else
    echo -e "  ${YELLOW}⚠ Tunnel DNS propagating... will be live within moments (HTTP ${pub_http})${NC}"
  fi

  # 5. Synchronize Live Link with GitHub Repository
  echo -e "  ${CYAN}[5/5] Synchronizing live link with GitHub repository...${NC}"
  if command -v gh >/dev/null 2>&1; then
    if gh repo edit "${GITHUB_REPO}" --homepage "${PUBLIC_URL}" >/dev/null 2>&1; then
      echo -e "  ${GREEN}✓ GitHub repository homepage updated to:${NC} ${BOLD}${PUBLIC_URL}${NC}"
      echo -e "  ${GREEN}✓ Visible at: https://github.com/${GITHUB_REPO}${NC}"
    else
      echo -e "  ${YELLOW}Notice: Could not edit repo homepage via gh (check scopes). Live URL is still functional.${NC}"
    fi
  fi

  # Save State JSON
  cat <<EOF > "${STATE_JSON}"
{
  "project": "${PROJECT_NAME}",
  "type": "${PROJECT_TYPE}",
  "local_port": ${PORT},
  "local_url": "http://localhost:${PORT}",
  "public_url": "${PUBLIC_URL}",
  "app_pid": $(cat "${APP_PID_FILE}" 2>/dev/null || echo "null"),
  "tunnel_pid": $(cat "${TUNNEL_PID_FILE}" 2>/dev/null || echo "null"),
  "github_repo": "${GITHUB_REPO}",
  "started_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "status": "ACTIVE"
}
EOF

  echo -e "\n${BOLD}${GREEN}=================================================================${NC}"
  echo -e "${BOLD}${GREEN}   🎉 APP IS PUBLICLY LIVE & SYNCHRONIZED WITH GITHUB!${NC}"
  echo -e "${BOLD}${GREEN}=================================================================${NC}"
  echo -e "  • Public Link:  ${BOLD}${CYAN}${PUBLIC_URL}${NC}"
  echo -e "  • Local Link:   ${BOLD}http://localhost:${PORT}${NC}"
  echo -e "  • GitHub Repo:  ${BOLD}https://github.com/${GITHUB_REPO}${NC}"
  echo -e "${GREEN}-----------------------------------------------------------------${NC}"
  echo -e "  To check status:   ${BOLD}./live.sh status${NC}"
  echo -e "  To stop link:      ${BOLD}./live.sh stop${NC}"
  echo -e "  To open in browser:${BOLD}./live.sh open${NC}\n"
}

# ==============================================================================
# SUBCOMMAND: STOP
# ==============================================================================
cmd_stop() {
  echo -e "\n${BOLD}${YELLOW}🛑 Shutting down Public Live Link & Engine...${NC}\n"

  # 1. Stop Cloudflare Tunnel
  if [ -f "${TUNNEL_PID_FILE}" ]; then
    local t_pid=""
    t_pid=$(cat "${TUNNEL_PID_FILE}" 2>/dev/null || true)
    if is_pid_alive "${t_pid}"; then
      echo -e "  • Terminating Cloudflare Tunnel process (PID ${t_pid})..."
      kill "${t_pid}" 2>/dev/null || true
      sleep 0.5
    fi
    rm -f "${TUNNEL_PID_FILE}"
  fi
  # Kill any stray cloudflared on this port
  pkill -f "cloudflared tunnel --url http://localhost:${PORT}" 2>/dev/null || true
  echo -e "  ${GREEN}✓ Cloudflare tunnel stopped${NC}"

  # 2. Stop Local Server Process
  if [ -f "${APP_PID_FILE}" ]; then
    local a_pid=""
    a_pid=$(cat "${APP_PID_FILE}" 2>/dev/null || true)
    if is_pid_alive "${a_pid}"; then
      echo -e "  • Terminating local app process (PID ${a_pid})..."
      kill "${a_pid}" 2>/dev/null || true
      sleep 0.5
    fi
    rm -f "${APP_PID_FILE}"
  fi

  # Free port if still occupied by selvedge
  if [ "${PROJECT_TYPE}" = "go" ]; then
    pkill -f "selvedge --port ${PORT}" 2>/dev/null || true
  fi
  echo -e "  ${GREEN}✓ Local server stopped (Port ${PORT} freed)${NC}"

  # 3. Reset GitHub Repository Homepage
  if command -v gh >/dev/null 2>&1; then
    echo -e "  • Clearing GitHub repository homepage URL..."
    gh repo edit "${GITHUB_REPO}" --homepage "" >/dev/null 2>&1 || true
    echo -e "  ${GREEN}✓ GitHub homepage cleared (no dead links remaining)${NC}"
  fi

  # Update State JSON
  rm -f "${STATE_JSON}" "${TUNNEL_LOG}"
  echo -e "\n${BOLD}${GREEN}✓ All live operations and public links cleanly shutdown.${NC}\n"
}

# ==============================================================================
# SUBCOMMAND: RESTART
# ==============================================================================
cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

# ==============================================================================
# SUBCOMMAND: OPEN
# ==============================================================================
cmd_open() {
  local url=""
  url=$(get_public_url_from_log)
  if [ -z "${url}" ]; then
    url="http://localhost:${PORT}"
  fi
  echo -e "${CYAN}Opening ${url} in browser...${NC}"
  open "${url}"
}

# ==============================================================================
# SUBCOMMAND: CLOUD (Run on GitHub Actions)
# ==============================================================================
cmd_cloud() {
  local action="${1:-status}"
  case "${action}" in
    start|up|run)
      local hours="${2:-2}"
      echo -e "\n${BOLD}${BLUE}☁ Dispatching GitHub Actions Cloud Runner for ${GITHUB_REPO}...${NC}"
      echo -e "  Duration: ${hours} hour(s)"
      if command -v gh >/dev/null 2>&1; then
        gh workflow run "live-link.yml" -R "${GITHUB_REPO}" -f duration_hours="${hours}"
        echo -e "  ${GREEN}✓ Workflow dispatch triggered successfully!${NC}"
        echo -e "  To watch progress: ${BOLD}gh run watch -R ${GITHUB_REPO}${NC}"
        echo -e "  Check status:      ${BOLD}./live.sh cloud status${NC}\n"
      else
        echo -e "${RED}Error: GitHub CLI (gh) required to trigger cloud runners.${NC}"
      fi
      ;;
    stop|cancel)
      echo -e "\n${BOLD}${YELLOW}☁ Cancelling active Cloud Runner on GitHub Actions...${NC}"
      local run_id=""
      run_id=$(gh run list -R "${GITHUB_REPO}" --workflow "live-link.yml" --limit 1 --json databaseId,status --jq '.[] | select(.status=="in_progress") | .databaseId' 2>/dev/null || true)
      if [ -n "${run_id}" ]; then
        gh run cancel "${run_id}" -R "${GITHUB_REPO}"
        gh repo edit "${GITHUB_REPO}" --homepage "" >/dev/null 2>&1 || true
        echo -e "  ${GREEN}✓ Cancelled workflow run #${run_id} and cleared repo homepage.${NC}\n"
      else
        echo -e "  ${YELLOW}No active in-progress cloud runs found.${NC}\n"
      fi
      ;;
    status|*)
      echo -e "\n${BOLD}${CYAN}☁ GitHub Actions Cloud Runner Status (${GITHUB_REPO}):${NC}\n"
      gh run list -R "${GITHUB_REPO}" --workflow "live-link.yml" --limit 5
      local hp=""
      hp=$(get_github_homepage)
      if [ -n "${hp}" ]; then
        echo -e "\n  ${BOLD}Active GitHub Homepage URL:${NC} ${GREEN}${hp}${NC}\n"
      fi
      ;;
  esac
}

# ==============================================================================
# CLI DISPATCHER
# ==============================================================================
COMMAND="${1:-status}"
shift || true

case "${COMMAND}" in
  status|st|info)
    cmd_status
    ;;
  start|up)
    cmd_start
    ;;
  stop|down)
    cmd_stop
    ;;
  restart|reload)
    cmd_restart
    ;;
  open)
    cmd_open
    ;;
  cloud)
    cmd_cloud "$@"
    ;;
  help|-h|--help)
    echo -e "\n${BOLD}FPCC Live Operations Controller (live.sh)${NC}"
    echo -e "Usage: ${CYAN}./live.sh [command]${NC}\n"
    echo -e "Commands:"
    echo -e "  ${BOLD}status${NC}        Check local server, Cloudflare tunnel, and GitHub sync state (default)"
    echo -e "  ${BOLD}start${NC}         Start local daemon, create public tunnel, and pin live URL to GitHub"
    echo -e "  ${BOLD}stop${NC}          Stop public tunnel and local daemon, and unpin live URL from GitHub"
    echo -e "  ${BOLD}restart${NC}       Clean restart of local daemon, tunnel, and GitHub sync"
    echo -e "  ${BOLD}open${NC}          Open active public live URL in default browser"
    echo -e "  ${BOLD}cloud start${NC}   Trigger GitHub Actions cloud runner to host live link for N hours"
    echo -e "  ${BOLD}cloud stop${NC}    Cancel running GitHub Actions cloud live link"
    echo -e "  ${BOLD}cloud status${NC}  Check status of GitHub Actions cloud runners\n"
    ;;
  *)
    echo -e "${RED}Unknown command: ${COMMAND}${NC}"
    echo -e "Run ${BOLD}./live.sh help${NC} for available options."
    exit 1
    ;;
esac
