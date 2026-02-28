#!/usr/bin/env bash
set -euo pipefail

PRD_PATH=""
BACKLOG_PATH=""
PLANNER_ITERATIONS=10
TEAM_ITERATIONS=20
REVIEWER_ITERATIONS=10
CYCLES=3

while [[ $# -gt 0 ]]; do
  case $1 in
    --prd) PRD_PATH="$2"; shift 2 ;;
    --backlog) BACKLOG_PATH="$2"; shift 2 ;;
    --planner-iterations) PLANNER_ITERATIONS="$2"; shift 2 ;;
    --team-iterations) TEAM_ITERATIONS="$2"; shift 2 ;;
    --reviewer-iterations) REVIEWER_ITERATIONS="$2"; shift 2 ;;
    --cycles) CYCLES="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$PRD_PATH" || -z "$BACKLOG_PATH" ]]; then
  echo "Usage: $0 --prd ./docs/prd/onboarding-port.md --backlog ./docs/onboarding/ralph-backlog.md [--cycles 3]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -f ".ralph-team/config.json" ]]; then
  bash "$SCRIPT_DIR/init.sh"
fi

bash "$SCRIPT_DIR/run-planner.sh" --prd "$PRD_PATH" --backlog "$BACKLOG_PATH" --max-iterations "$PLANNER_ITERATIONS" || true

cycle=0
while [[ $cycle -lt $CYCLES ]]; do
  cycle=$((cycle + 1))
  echo "🔄 Cycle $cycle / $CYCLES"
  bash "$SCRIPT_DIR/run-team.sh" --max-iterations "$TEAM_ITERATIONS" || true
  bash "$SCRIPT_DIR/run-reviewer.sh" --max-iterations "$REVIEWER_ITERATIONS" || true
done

echo "✅ Completed $CYCLES cycle(s)."

