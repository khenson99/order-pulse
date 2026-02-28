# backend-core (Claude Code)

Focus: auth/JWT, session persistence, durable storage interfaces, and “core” backend primitives.

## Deliverables
- JWT auth gate middleware and consistent tenant extraction
- Durable session storage (Redis TTL recommended)
- API contract alignment with `.ralph-team/api-contract.yaml`
- Logging/request IDs for onboarding endpoints

## Definition of done
- Endpoints are correct, durable, and documented
- Errors mapped into stable response shapes (no ad-hoc 500s)
- Unit/contract tests added where feasible

