# onboarding-api

Backend service for onboarding durable session storage and ingestion/providers (scan/photo → review inputs), intended to be used by the frontend via stable `/api/onboarding/*` proxy routes.

## Ralph Team Loop v2
- Init: `./scripts/ralph-team-v2/init.sh --project-url "https://github.com/orgs/Arda-cards/projects/14" --repo-type backend`
- Planner: `./scripts/ralph-team-v2/run-planner.sh --prd ./docs/prd/onboarding-port.md --backlog ./docs/onboarding/ralph-backlog.md --max-iterations 10`
- Team: `./scripts/ralph-team-v2/run-team.sh --max-iterations 20`
- Reviewer: `./scripts/ralph-team-v2/run-reviewer.sh --max-iterations 10`
