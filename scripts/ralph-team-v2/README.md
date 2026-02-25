# Ralph Team Loop v2 (Expanded Lanes)

This repo supports an expanded “lane-based” Ralph Team Loop for shipping the onboarding port via vertical slices, using GitHub Project 14 as the canonical backlog.

## Agent Lanes (v2)
- Orchestration:
  - Planner (Codex)
  - Architect (Claude Code)
  - Reviewer (Codex; auto-merge on approve)
- Implementation:
  - `backend-core`
  - `backend-ingestion`
  - `backend-integrations`
  - `frontend-flow`
  - `frontend-mobile`
  - `qa-agent`
  - `design-enforcer`

## One-time init
Creates/migrates `.ralph-team/` local state (gitignored) and attempts to bootstrap labels.

```bash
./scripts/ralph-team-v2/init.sh --project-url "https://github.com/orgs/Arda-cards/projects/14" --repo-type frontend
```

## Run loops
Planner:
```bash
./scripts/ralph-team-v2/run-planner.sh --prd ./docs/prd/onboarding-port.md --backlog ./docs/onboarding/ralph-backlog.md --max-iterations 10
```

Team (Claude Code):
```bash
./scripts/ralph-team-v2/run-team.sh --max-iterations 20
```

Reviewer (Codex):
```bash
./scripts/ralph-team-v2/run-reviewer.sh --max-iterations 10
```

All:
```bash
./scripts/ralph-team-v2/run-all.sh --prd ./docs/prd/onboarding-port.md --backlog ./docs/onboarding/ralph-backlog.md --cycles 3
```

## Notes
- `.ralph-team/` is local-only. Do not commit it.
- The GitHub CLI needs `project` scope to add issues to Project 14:
  - `gh auth refresh -s project`
- If Codex CLI errors about session file permissions:
  - `sudo chown -R "$(whoami)" ~/.codex`

