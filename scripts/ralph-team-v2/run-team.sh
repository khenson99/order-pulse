#!/usr/bin/env bash
set -euo pipefail

MAX_ITERATIONS=20
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS_DIR="$SCRIPT_DIR/agents"

while [[ $# -gt 0 ]]; do
  case $1 in
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ ! -f ".ralph-team/config.json" ]]; then
  echo "Error: .ralph-team/config.json not found. Run ./scripts/ralph-team-v2/init.sh first." >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "Error: claude (Claude Code) not found in PATH. Install/auth before running team loop." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh not found in PATH (required to read issues/PRs and open PRs)." >&2
  exit 1
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "Error: gh is not authenticated and/or cannot reach GitHub." >&2
  gh auth status -h github.com || true
  echo "" >&2
  echo "Fix (in a normal terminal with internet):" >&2
  echo "  gh auth login -h github.com" >&2
  exit 2
fi

REPO_TYPE=$(jq -r '.repo_type' .ralph-team/config.json)
DETECTED_STACK=$(jq -c '.detected_stack' .ralph-team/config.json)

echo "🏗️  Starting Team Loop (Claude Code v2)"
echo "   Repo type: $REPO_TYPE"
echo "   Max iterations: $MAX_ITERATIONS"

run_agent() {
  local AGENT_ROLE="$1"
  local TICKET_NUMBER="$2"
  local AGENT_MAX_ITERATIONS="${3:-$MAX_ITERATIONS}"
  local AGENT_SPEC="$AGENTS_DIR/${AGENT_ROLE}.md"

  if [[ ! -f "$AGENT_SPEC" ]]; then
    echo "  ⚠️  No agent spec found for: $AGENT_ROLE ($AGENT_SPEC)" >&2
    return 1
  fi

  local TASK_FILE=".ralph-team/current-tasks/${AGENT_ROLE}.json"
  local AGENT_KNOWLEDGE=".ralph-team/agents/${AGENT_ROLE}.md"

  local TICKET_BODY=""
  TICKET_BODY=$(gh issue view "$TICKET_NUMBER" --json body,title,labels -q '.title + "\n\n" + .body' 2>/dev/null || echo "Could not fetch ticket")

  cat > "$TASK_FILE" <<JSON
{
  "ticket_number": $TICKET_NUMBER,
  "agent": "$AGENT_ROLE",
  "repo_type": "$REPO_TYPE",
  "detected_stack": $DETECTED_STACK
}
JSON

  local AGENT_ITERATION=0
  while [[ $AGENT_ITERATION -lt $AGENT_MAX_ITERATIONS ]]; do
    AGENT_ITERATION=$((AGENT_ITERATION + 1))
    echo "    ── $AGENT_ROLE iteration $AGENT_ITERATION / $AGENT_MAX_ITERATIONS ──"

    local PROGRESS_TAIL=""
    PROGRESS_TAIL=$(tail -50 .ralph-team/progress.txt 2>/dev/null || echo "No progress yet")

    local PROMPT_FILE=""
    PROMPT_FILE="$(mktemp -t ralph-agent-prompt.XXXXXX)"
    cat >"$PROMPT_FILE" <<AGENT_PROMPT_EOF
You are the $AGENT_ROLE agent in Ralph Team Loop v2.

## Role Spec
$(cat "$AGENT_SPEC")

## Assignment
Ticket #$TICKET_NUMBER:
$TICKET_BODY

## Context
- Repo type: $REPO_TYPE
- Detected stack: $DETECTED_STACK
- Iteration: $AGENT_ITERATION of $AGENT_MAX_ITERATIONS

## Accumulated Knowledge
$(cat "$AGENT_KNOWLEDGE" 2>/dev/null || echo "No accumulated knowledge yet")

## Recent Progress
$PROGRESS_TAIL

## Instructions
1) Implement the ticket in this repo (or coordinate if it belongs in another repo).
2) Add/adjust tests according to the ticket Test Plan.
3) Open a PR that closes the issue.
4) Update .ralph-team/progress.txt with learnings.
5) Update .ralph-team/agents/${AGENT_ROLE}.md with discovered patterns.
6) When done, output: <promise>TICKET_DONE</promise>
7) If blocked, output: <promise>BLOCKED</promise> with a reason.
AGENT_PROMPT_EOF
    PROMPT="$(cat "$PROMPT_FILE")"
    rm -f "$PROMPT_FILE" 2>/dev/null || true

    OUTPUT=$(claude -p "$PROMPT" --dangerously-skip-permissions 2>&1) || true

    if echo "$OUTPUT" | grep -q "<promise>TICKET_DONE</promise>"; then
      echo "    ✅ $AGENT_ROLE completed ticket #$TICKET_NUMBER"
      return 0
    fi

    if echo "$OUTPUT" | grep -q "<promise>BLOCKED</promise>"; then
      echo "    🚫 $AGENT_ROLE blocked on ticket #$TICKET_NUMBER"
      return 2
    fi

    sleep 1
  done

  echo "    ⚠️  $AGENT_ROLE hit max iterations on ticket #$TICKET_NUMBER"
  return 1
}

ARCHITECT_ITERATION=0
while [[ $ARCHITECT_ITERATION -lt $MAX_ITERATIONS ]]; do
  ARCHITECT_ITERATION=$((ARCHITECT_ITERATION + 1))
  echo ""
  echo "━━━ Architect Iteration $ARCHITECT_ITERATION / $MAX_ITERATIONS ━━━"

  ARCH_PROMPT_FILE="$(mktemp -t ralph-architect-prompt.XXXXXX)"
  cat >"$ARCH_PROMPT_FILE" <<ARCH_PROMPT_EOF
You are the Architect agent for Ralph Team Loop v2.

## Role Spec
$(cat "$AGENTS_DIR/architect.md")

## Current Team State
$(cat .ralph-team/team-state.json)

## Open Issues
$(gh issue list --state open --json number,title,labels,assignees --limit 200 2>/dev/null || echo "[]")

## Open PRs
$(gh pr list --state open --json number,title,labels,reviewDecision --limit 100 2>/dev/null || echo "[]")

## Recent Progress
$(tail -50 .ralph-team/progress.txt 2>/dev/null || echo "No progress yet")

## Context
- Repo type: $REPO_TYPE
- Detected stack: $DETECTED_STACK
- Iteration: $ARCHITECT_ITERATION of $MAX_ITERATIONS

Respond with ONLY valid JSON per your spec.
ARCH_PROMPT_EOF
  ARCHITECT_PROMPT="$(cat "$ARCH_PROMPT_FILE")"
  rm -f "$ARCH_PROMPT_FILE" 2>/dev/null || true

  ARCHITECT_OUTPUT=$(claude -p "$ARCHITECT_PROMPT" --dangerously-skip-permissions 2>&1) || true

  ACTION_PLAN=$(echo "$ARCHITECT_OUTPUT" | python3 - <<'PY'
import sys, json, re
text = sys.stdin.read()
m = re.search(r'\{[\s\S]*\}', text)
if not m:
  print("{}")
  raise SystemExit
try:
  obj = json.loads(m.group(0))
  print(json.dumps(obj))
except Exception:
  print("{}")
PY
)

  SPRINT_COMPLETE=$(echo "$ACTION_PLAN" | jq -r '.sprint_complete // false' 2>/dev/null || echo "false")
  SPRINT_BLOCKED=$(echo "$ACTION_PLAN" | jq -r '.sprint_blocked // false' 2>/dev/null || echo "false")

  if [[ "$SPRINT_COMPLETE" == "true" ]]; then
    echo "🎉 Sprint complete!"
    exit 0
  fi
  if [[ "$SPRINT_BLOCKED" == "true" ]]; then
    echo "🚫 Sprint blocked."
    exit 2
  fi

  ASSIGNMENTS=$(echo "$ACTION_PLAN" | jq -c '.assignments // []' 2>/dev/null || echo "[]")
  NUM_ASSIGNMENTS=$(echo "$ASSIGNMENTS" | jq 'length' 2>/dev/null || echo "0")

  if [[ "$NUM_ASSIGNMENTS" -gt 0 ]]; then
    echo "  📝 Architect assigned $NUM_ASSIGNMENTS tickets"
    echo "$ASSIGNMENTS" | jq -c '.[]' | while read -r assignment; do
      TICKET=$(echo "$assignment" | jq -r '.ticket')
      AGENT=$(echo "$assignment" | jq -r '.agent')
      NOTES=$(echo "$assignment" | jq -r '.notes // ""')

      echo "  ─── Dispatching $AGENT for ticket #$TICKET ───"
      echo "  Notes: $NOTES"

      jq --arg tn "$TICKET" --arg agent "$AGENT" \
        '.tickets[$tn] = {"status": "in-progress", "agent": $agent} | .agents[$agent].status = "working" | .agents[$agent].current_ticket = ($tn | tonumber)' \
        .ralph-team/team-state.json > /tmp/team-state-tmp.json && mv /tmp/team-state-tmp.json .ralph-team/team-state.json 2>/dev/null || true

      run_agent "$AGENT" "$TICKET" "$MAX_ITERATIONS" || true

      jq --arg agent "$AGENT" \
        '.agents[$agent].status = "idle" | .agents[$agent].current_ticket = null' \
        .ralph-team/team-state.json > /tmp/team-state-tmp.json && mv /tmp/team-state-tmp.json .ralph-team/team-state.json 2>/dev/null || true
    done
  else
    echo "  ℹ️  No new assignments"
  fi

  sleep 2
done

echo "⚠️  Architect hit max iterations ($MAX_ITERATIONS)."
exit 1
