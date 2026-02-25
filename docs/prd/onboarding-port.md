# PRD — Port OrderPulse Onboarding into `arda-frontend-app`

## Objective
Port the standalone onboarding experience from `Arda-cards/onboarding` into this Next.js app, preserving the full multi-step flow while refactoring into clear domain modules and executing via agent-led development.

## Users
- New Arda users onboarding into inventory setup.
- Existing users who need to add inventory items via URL/scan/photo/CSV.

## Success criteria
- New users can complete onboarding end-to-end and create items in Arda from the review step.
- Mobile scan and photo capture can add items to the desktop session in ≤ 3 seconds.
- Flow is resilient to partial failures (rate limits, missing enrichment).
- No “flash logout” or token-clearing for non-auth 401s.

## Scope (v1)
Full flow:
1. Welcome
2. Email sync + supplier discovery + jobs
3. Integrations (QuickBooks/Xero)
4. URL ingestion (≤ 50 URLs per scrape)
5. UPC scanning (desktop input + mobile camera)
6. Photo capture (desktop upload + mobile camera)
7. CSV import
8. Review + sync to Arda

## Non-goals (v1)
- Perfect 1:1 UI styling parity with the standalone app.
- Full production-grade job orchestration in the Next.js runtime (may be externalized).

## Requirements

### Auth model
- Cognito is the source of truth for identity.
- Onboarding APIs require:
  - `Authorization: Bearer <accessToken>`
  - `X-ID-Token: <idToken>`

### API contract
Implement the onboarding API contract described in `docs/onboarding/target-architecture.md`.

### Data + storage
- Session-scoped scan/photo data must be durable enough for mobile ↔ desktop sync.
- Production: Redis (TTL) preferred.
- Development: in-memory fallback acceptable.

### Privacy & security
- Session write endpoints must not be writable by guessing a sessionId.
- OAuth tokens must be encrypted at rest.
- Avoid storing raw email bodies unless strictly required for extraction; prefer derived structured data.

## Acceptance criteria (by step)

### Welcome
- Shows step overview.
- “Start email sync” advances to Email step.
- “Skip email” marks email step complete and advances to Integrations.

### Email
- Shows Gmail connection status.
- Allows starting jobs and polling status.
- Allows selecting additional suppliers (when discovery available).

### Integrations
- Shows connect buttons for QuickBooks and Xero.
- Shows connection status + last run + manual sync.

### URLs
- Allows entering up to 50 URLs and scraping.
- Forces review/approval before continuing.

### UPC scan
- Desktop: barcode entry supports scanner bursts.
- Mobile: tokenized scan URL posts items to the session.
- Desktop sees new scans within ≤ 3 seconds.

### Photos
- Desktop upload adds photo entries and editable metadata.
- Mobile capture posts photo entries (base64 ok for dev) to the session.
- Desktop sees new photos within ≤ 3 seconds.

### CSV
- Supports uploading a CSV and mapping/approving rows (minimum: parse + import into review list).

### Review + sync
- Review list merges items from all sources.
- User can edit/remove rows.
- “Sync selected” creates items in Arda via existing `/api/arda/items` route.
- Completion sets onboarding complete flag and routes user to `/items`.

## Observability
- API routes log request IDs and step-relevant events.
- Surface error messages in UI with actionable guidance.

