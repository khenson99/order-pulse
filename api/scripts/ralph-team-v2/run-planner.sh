#!/usr/bin/env bash
set -euo pipefail

PRD_PATH=""
BACKLOG_PATH=""
MAX_ITERATIONS=10

while [[ $# -gt 0 ]]; do
  case $1 in
    --prd) PRD_PATH="$2"; shift 2 ;;
    --backlog) BACKLOG_PATH="$2"; shift 2 ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$PRD_PATH" || -z "$BACKLOG_PATH" ]]; then
  echo "Usage: $0 --prd ./docs/prd/onboarding-port.md --backlog ./docs/onboarding/ralph-backlog.md [--max-iterations 10]" >&2
  exit 1
fi

if [[ ! -f ".ralph-team/config.json" ]]; then
  echo "Error: .ralph-team/config.json not found. Run ./scripts/ralph-team-v2/init.sh first." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh not found in PATH (required for planner to list/create issues and add to Project)." >&2
  exit 1
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "Error: gh is not authenticated and/or cannot reach GitHub." >&2
  gh auth status -h github.com || true
  echo "" >&2
  echo "Fix (in a normal terminal with internet):" >&2
  echo "  gh auth login -h github.com" >&2
  echo "  gh auth refresh -s project" >&2
  exit 2
fi

PROJECT_URL=$(jq -r '.project_url' .ralph-team/config.json)
REPO_TYPE=$(jq -r '.repo_type' .ralph-team/config.json)
DETECTED_STACK=$(jq -c '.detected_stack' .ralph-team/config.json)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS_DIR="$SCRIPT_DIR/agents"

export CODEX_REAL_BIN
CODEX_REAL_BIN="$(command -v codex || true)"
export PATH
PATH="$SCRIPT_DIR/bin:$PATH"

echo "📋 Starting Planner Loop (Codex v2)"
echo "   PRD: $PRD_PATH"
echo "   Backlog: $BACKLOG_PATH"
echo "   Max iterations: $MAX_ITERATIONS"
echo "   Project: $PROJECT_URL"

ITERATION=0

while [[ $ITERATION -lt $MAX_ITERATIONS ]]; do
  ITERATION=$((ITERATION + 1))
  echo ""
  echo "━━━ Planner Iteration $ITERATION / $MAX_ITERATIONS ━━━"

  PROMPT_FILE="$(mktemp -t ralph-planner-prompt.XXXXXX)"
  cleanup() {
    rm -f "$PROMPT_FILE" 2>/dev/null || true
  }
  trap cleanup EXIT

  cat >"$PROMPT_FILE" <<PROMPT_EOF
You are the Planner agent for a Ralph Team Loop v2.

## Context
- Repo type: $REPO_TYPE
- Detected stack: $DETECTED_STACK
- Project URL: $PROJECT_URL
- Iteration: $ITERATION of $MAX_ITERATIONS

## PRD
$(cat "$PRD_PATH")

## Backlog
$(cat "$BACKLOG_PATH")

## Existing Issues (open)
$(gh issue list --state open --json number,title,labels --limit 200 2>/dev/null || echo "[]")

## Agent Specification
$(cat "$AGENTS_DIR/planner.md")

## Instructions
1) Create missing GitHub issues (avoid duplicates).
2) Apply v2 lane labels and other labels (priority/type/repo/status).
3) Add each created issue to the Project board.
4) If ALL items now have tickets, output: <promise>PLANNING_COMPLETE</promise>

PROMPT_EOF

  PROMPT="$(cat "$PROMPT_FILE")"
  cleanup
  trap - EXIT

  OUTPUT=$(codex exec --yolo -p "$PROMPT" 2>&1) || true
  echo "$OUTPUT"

if echo "$OUTPUT" | grep -q "<promise>PLANNING_COMPLETE</promise>"; then
  echo "✅ Planner complete!"
  echo "--- Planner Complete ---" >> .ralph-team/progress.txt
  echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> .ralph-team/progress.txt
  echo "Iterations used: $ITERATION" >> .ralph-team/progress.txt
  echo "" >> .ralph-team/progress.txt
  exit 0
fi

sleep 2
done

echo "⚠️  Planner hit max iterations ($MAX_ITERATIONS) without completing."
exit 1
