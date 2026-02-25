#!/usr/bin/env bash
set -euo pipefail

MAX_ITERATIONS=10
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

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh not found in PATH (required to list/review/merge PRs)." >&2
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

export CODEX_REAL_BIN
CODEX_REAL_BIN="$(command -v codex || true)"
export PATH
PATH="$SCRIPT_DIR/bin:$PATH"

REPO_TYPE=$(jq -r '.repo_type' .ralph-team/config.json)
DETECTED_STACK=$(jq -c '.detected_stack' .ralph-team/config.json)

echo "🔍 Starting Reviewer Loop (Codex v2)"
echo "   Max iterations: $MAX_ITERATIONS"

ITERATION=0
while [[ $ITERATION -lt $MAX_ITERATIONS ]]; do
  ITERATION=$((ITERATION + 1))
  echo ""
  echo "━━━ Reviewer Iteration $ITERATION / $MAX_ITERATIONS ━━━"

  OPEN_PRS=$(gh pr list --state open --json number,title,headRefName,author,labels,body,additions,deletions,changedFiles --limit 50 2>/dev/null || echo "[]")
  PR_COUNT=$(echo "$OPEN_PRS" | jq 'length')

  if [[ "$PR_COUNT" == "0" ]]; then
    echo "   No open PRs."
    exit 0
  fi

  for PR_NUM in $(echo "$OPEN_PRS" | jq -r '.[].number'); do
    PR_TITLE=$(echo "$OPEN_PRS" | jq -r ".[] | select(.number == $PR_NUM) | .title")
    PR_BODY=$(echo "$OPEN_PRS" | jq -r ".[] | select(.number == $PR_NUM) | .body")
    echo "   📝 Reviewing PR #$PR_NUM: $PR_TITLE"

    PR_DIFF=$(gh pr diff "$PR_NUM" 2>/dev/null || echo "Unable to fetch diff")
    PR_COMMENTS=$(gh pr view "$PR_NUM" --json reviews --jq '.reviews[].body' 2>/dev/null || echo "No reviews yet")

    PROMPT_FILE="$(mktemp -t ralph-reviewer-prompt.XXXXXX)"
    cat >"$PROMPT_FILE" <<PROMPT_EOF
You are the Reviewer agent for Ralph Team Loop v2.

## Context
- Repo type: $REPO_TYPE
- Detected stack: $DETECTED_STACK
- Iteration: $ITERATION of $MAX_ITERATIONS

## PR #$PR_NUM: $PR_TITLE

### PR Body
$PR_BODY

### Previous Reviews
$PR_COMMENTS

### Diff
$PR_DIFF

## Agent Specification
$(cat "$AGENTS_DIR/reviewer.md")

## Instructions
If APPROVED:
- gh pr review $PR_NUM --approve --body "..."
- gh pr merge $PR_NUM --squash --delete-branch
- Output: <promise>PR_${PR_NUM}_APPROVED</promise>

If CHANGES:
- gh pr review $PR_NUM --request-changes --body "..."
- Output: <promise>PR_${PR_NUM}_CHANGES_REQUESTED</promise>

PROMPT_EOF
    PROMPT="$(cat "$PROMPT_FILE")"
    rm -f "$PROMPT_FILE" 2>/dev/null || true

    OUTPUT=$(codex exec --yolo -p "$PROMPT" 2>&1) || true
    echo "$OUTPUT"
    sleep 2
  done
done

echo "⚠️  Reviewer hit max iterations ($MAX_ITERATIONS)."
exit 1
