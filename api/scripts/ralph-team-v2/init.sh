#!/usr/bin/env bash
set -euo pipefail

PROJECT_URL="https://github.com/orgs/Arda-cards/projects/14"
REPO_TYPE="frontend"

while [[ $# -gt 0 ]]; do
  case $1 in
    --project-url) PROJECT_URL="$2"; shift 2 ;;
    --repo-type) REPO_TYPE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p .ralph-team/agents .ralph-team/current-tasks .ralph-team/prompts

bootstrap_labels() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "ℹ️  gh not found; skipping label bootstrap"
    return 0
  fi

  local origin_url=""
  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  if [[ -z "$origin_url" ]]; then
    echo "ℹ️  No git origin remote; skipping label bootstrap"
    return 0
  fi

  local repo=""
  if [[ "$origin_url" =~ ^https://github.com/([^/]+/[^/.]+)(\.git)?$ ]]; then
    repo="${BASH_REMATCH[1]}"
  elif [[ "$origin_url" =~ ^git@github.com:([^/]+/[^/.]+)(\.git)?$ ]]; then
    repo="${BASH_REMATCH[1]}"
  fi

  if [[ -z "$repo" ]]; then
    echo "ℹ️  Could not parse repo from origin URL ($origin_url); skipping label bootstrap"
    return 0
  fi

  echo "🏷️  Bootstrapping v2 labels in $repo (best-effort)"
  set +e

  # v2 routing labels
  gh label create "agent:backend-core" --color 0052CC --description "Ralph routing: backend core" --force -R "$repo" >/dev/null 2>&1
  gh label create "agent:backend-ingestion" --color 0052CC --description "Ralph routing: backend ingestion" --force -R "$repo" >/dev/null 2>&1
  gh label create "agent:backend-integrations" --color 0052CC --description "Ralph routing: backend integrations" --force -R "$repo" >/dev/null 2>&1
  gh label create "agent:frontend-flow" --color 0E8A16 --description "Ralph routing: frontend flow" --force -R "$repo" >/dev/null 2>&1
  gh label create "agent:frontend-mobile" --color 0E8A16 --description "Ralph routing: frontend mobile" --force -R "$repo" >/dev/null 2>&1
  gh label create "agent:qa" --color 5319E7 --description "Ralph routing: QA" --force -R "$repo" >/dev/null 2>&1
  gh label create "agent:design-system" --color FBCA04 --description "Ralph routing: design system" --force -R "$repo" >/dev/null 2>&1

  # shared labels used by planner
  gh label create "priority:high" --color B60205 --description "High priority" --force -R "$repo" >/dev/null 2>&1
  gh label create "priority:medium" --color D93F0B --description "Medium priority" --force -R "$repo" >/dev/null 2>&1
  gh label create "priority:low" --color 0E8A16 --description "Low priority" --force -R "$repo" >/dev/null 2>&1

  gh label create "type:feature" --color 1D76DB --description "Feature work" --force -R "$repo" >/dev/null 2>&1
  gh label create "type:bug" --color D73A4A --description "Bug fix" --force -R "$repo" >/dev/null 2>&1
  gh label create "type:chore" --color C5DEF5 --description "Chore/infra" --force -R "$repo" >/dev/null 2>&1
  gh label create "type:test" --color 5319E7 --description "Testing" --force -R "$repo" >/dev/null 2>&1

  gh label create "repo:frontend" --color 0E8A16 --description "Frontend repo work" --force -R "$repo" >/dev/null 2>&1
  gh label create "repo:backend" --color 0052CC --description "Backend repo work" --force -R "$repo" >/dev/null 2>&1
  gh label create "repo:shared" --color C2E0C6 --description "Shared work" --force -R "$repo" >/dev/null 2>&1

  gh label create "status:ready" --color 0E8A16 --description "Ready to pick up" --force -R "$repo" >/dev/null 2>&1
  gh label create "status:blocked" --color B60205 --description "Blocked" --force -R "$repo" >/dev/null 2>&1
  gh label create "status:in-progress" --color D93F0B --description "In progress" --force -R "$repo" >/dev/null 2>&1
  gh label create "status:done" --color 5319E7 --description "Done" --force -R "$repo" >/dev/null 2>&1

  set -e
}

STACK_JSON="$(python3 - <<'PY'
import json
from pathlib import Path
p = Path('package.json')
framework = 'unknown'
styling = 'unknown'
test_framework = 'unknown'
if p.exists():
  data = json.loads(p.read_text('utf-8'))
  deps = data.get('dependencies', {})
  dev = data.get('devDependencies', {})
  if 'next' in deps or 'next' in dev:
    framework = 'nextjs'
  styling = 'tailwind' if ('tailwindcss' in deps or 'tailwindcss' in dev) else 'unknown'
  test_framework = 'jest' if ('jest' in deps or 'jest' in dev) else 'unknown'
print(json.dumps({
  "package_manager": "npm",
  "language": "typescript",
  "framework": framework,
  "styling": styling,
  "test_framework": test_framework,
}))
PY
)"

cat > .ralph-team/config.json <<JSON
{
  "project_url": "$PROJECT_URL",
  "repo_type": "$REPO_TYPE",
  "repo_name": "$(basename "$(pwd)")",
  "repo_url": "$(git remote get-url origin 2>/dev/null || echo "")",
  "detected_stack": $STACK_JSON,
  "labels": {
    "agent_routing": [
      "agent:backend-core",
      "agent:backend-ingestion",
      "agent:backend-integrations",
      "agent:frontend-flow",
      "agent:frontend-mobile",
      "agent:qa",
      "agent:design-system"
    ],
    "priority": ["priority:high", "priority:medium", "priority:low"],
    "type": ["type:feature", "type:bug", "type:chore", "type:test"],
    "repo": ["repo:backend", "repo:frontend", "repo:shared"],
    "status": ["status:ready", "status:blocked", "status:in-progress", "status:done"]
  },
  "initialized_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

TEAM_STATE=".ralph-team/team-state.json"
if [[ -f "$TEAM_STATE" ]]; then
  # Migrate old short agent keys to v2 lane IDs.
  python3 - <<'PY'
import json
from pathlib import Path
p = Path(".ralph-team/team-state.json")
data = json.loads(p.read_text("utf-8"))
agents = data.get("agents", {})

def take(old_key):
  return agents.get(old_key, {"status": "idle", "current_ticket": None, "iterations": 0})

new_agents = {
  "architect": take("architect"),
  "backend-core": take("backend"),
  "backend-ingestion": {"status": "idle", "current_ticket": None, "iterations": 0},
  "backend-integrations": {"status": "idle", "current_ticket": None, "iterations": 0},
  "frontend-flow": take("frontend"),
  "frontend-mobile": {"status": "idle", "current_ticket": None, "iterations": 0},
  "qa-agent": take("qa"),
  "design-enforcer": take("design-enforcer"),
  "reviewer": {"status": "idle", "current_ticket": None, "iterations": 0},
}

data["agents"] = new_agents
data.setdefault("tickets", {})
data.setdefault("sprint", {
  "status": "not_started",
  "total_tickets": 0,
  "completed_tickets": 0,
  "blocked_tickets": 0,
  "iteration": 0
})
p.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print("Migrated .ralph-team/team-state.json to v2")
PY
else
  cat > "$TEAM_STATE" <<'JSON'
{
  "tickets": {},
  "agents": {
    "architect": { "status": "idle", "current_ticket": null, "iterations": 0 },
    "backend-core": { "status": "idle", "current_ticket": null, "iterations": 0 },
    "backend-ingestion": { "status": "idle", "current_ticket": null, "iterations": 0 },
    "backend-integrations": { "status": "idle", "current_ticket": null, "iterations": 0 },
    "frontend-flow": { "status": "idle", "current_ticket": null, "iterations": 0 },
    "frontend-mobile": { "status": "idle", "current_ticket": null, "iterations": 0 },
    "qa-agent": { "status": "idle", "current_ticket": null, "iterations": 0 },
    "design-enforcer": { "status": "idle", "current_ticket": null, "iterations": 0 },
    "reviewer": { "status": "idle", "current_ticket": null, "iterations": 0 }
  },
  "sprint": {
    "status": "not_started",
    "total_tickets": 0,
    "completed_tickets": 0,
    "blocked_tickets": 0,
    "iteration": 0
  }
}
JSON
fi

# Ensure knowledge files exist
for f in \
  architect backend-core backend-ingestion backend-integrations \
  frontend-flow frontend-mobile qa-agent design-enforcer reviewer; do
  [[ -f ".ralph-team/agents/${f}.md" ]] || echo "# ${f}\n" > ".ralph-team/agents/${f}.md"
done

[[ -f .ralph-team/architecture-decisions.md ]] || printf "# Architecture Decisions\n\n" > .ralph-team/architecture-decisions.md
[[ -f .ralph-team/progress.txt ]] || printf "" > .ralph-team/progress.txt
[[ -f .ralph-team/api-contract.yaml ]] || cat > .ralph-team/api-contract.yaml <<'YAML'
openapi: 3.1.0
info:
  title: Onboarding API (v2)
  version: 0.0.0
paths: {}
YAML

echo "✅ Ralph Team Loop v2 initialized (local state in .ralph-team/)"

bootstrap_labels || true
