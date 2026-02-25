# Onboarding API — Ralph Team Loop Backlog (v2, backend repo)

This file is a repo-local, planner-ready breakdown of backend-only onboarding work into atomic tickets for Ralph Team Loop v2, targeting GitHub Project 14.

Source PRD (copied from frontend repo): `docs/prd/onboarding-port.md`

## Labels
- Routing (v2 lanes): `agent:backend-core`, `agent:backend-ingestion`, `agent:backend-integrations`
- Type: `type:feature`, `type:bug`, `type:chore`, `type:test`
- Priority: `priority:high`, `priority:medium`, `priority:low`
- Repo: `repo:backend`, `repo:shared`
- Status: `status:ready`, `status:blocked`, `status:in-progress`, `status:done`

## Required issue body sections (Planner will enforce)
- Context
- Acceptance Criteria
- API Contract Impact
- Data Model / Storage
- Failure Modes
- Telemetry
- Test Plan
- Rollout / Flagging

## Tickets (ordered)

### 1) Backend: onboarding-api skeleton (JWT auth + tenant resolution)
- Labels: `agent:backend-core`, `type:feature`, `priority:high`, `repo:backend`, `status:ready`
- Acceptance:
  - All onboarding endpoints require Cognito JWT; 401 on missing/invalid.
  - Extract `{sub,email,custom:tenant}` (or equivalent) consistently.
  - Request IDs and structured logs exist for all endpoints.

### 2) Backend: sessions persistence for scan/photo (Redis TTL)
- Labels: `agent:backend-core`, `type:feature`, `priority:high`, `repo:backend`, `status:ready`
- Acceptance:
  - Create session; mobile writes; desktop reads; survives restarts.
  - TTL behavior is defined and implemented.
  - Concurrency/duplication behavior is deterministic.

### 3) Backend: image upload storage (S3 or equivalent)
- Labels: `agent:backend-ingestion`, `type:feature`, `priority:high`, `repo:backend`, `status:ready`
- Acceptance:
  - Upload endpoint returns stable `imageUrl` / object key.
  - Size limits + content-type validation enforced.
  - Signed URL strategy documented (if used).

### 4) Contract: publish stable API contract + error shapes
- Labels: `agent:backend-core`, `type:chore`, `priority:high`, `repo:backend`, `status:ready`
- Acceptance:
  - OpenAPI is maintained and versioned.
  - Errors use stable response shapes (no ad-hoc 500 bodies).
  - Backwards-compatible change policy is documented.

### 5) Backend: barcode lookup provider
- Labels: `agent:backend-integrations`, `type:feature`, `priority:medium`, `repo:backend`, `status:ready`

### 6) Backend: URL scrape implementation
- Labels: `agent:backend-integrations`, `type:feature`, `priority:medium`, `repo:backend`, `status:ready`

### 7) Backend: photo analysis (Gemini optional)
- Labels: `agent:backend-integrations`, `type:feature`, `priority:medium`, `repo:backend`, `status:ready`
- Acceptance:
  - Works when Gemini key present; degrades gracefully when absent.

### 8) Backend: Gmail OAuth + tokens encrypted
- Labels: `agent:backend-integrations`, `type:feature`, `priority:high`, `repo:backend`, `status:blocked`
- Blocker: confirm OAuth infra, encryption/KMS strategy, allowed scopes.

### 9) Backend: QuickBooks/Xero connectors behind flag
- Labels: `agent:backend-integrations`, `type:feature`, `priority:low`, `repo:backend`, `status:blocked`
