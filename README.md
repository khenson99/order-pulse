# onboarding-api

Backend service for onboarding durable session storage and ingestion/providers (scan/photo → review inputs), intended to be used by the frontend via stable `/api/onboarding/*` proxy routes.

## Environment

### Required
- `COGNITO_USER_POOL_ID`: Cognito User Pool ID used to verify JWTs.
- `COGNITO_CLIENT_ID`: Cognito App Client ID used to verify JWTs.
- `REDIS_URL`: Redis connection string for durable session/token state.
- `ONBOARDING_API_ORIGIN`: Public origin for this service (used for OAuth redirect URIs).
- `ONBOARDING_FRONTEND_ORIGIN`: Frontend origin to redirect back to after OAuth and to build mobile URLs.

### Gmail OAuth (recommended for Gmail features)
- `GOOGLE_CLIENT_ID`: Google OAuth client id for Gmail authorization.
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret for Gmail authorization.
- `ONBOARDING_TOKEN_ENCRYPTION_KEY_BASE64`: 32-byte base64 key used for AES-256-GCM encryption of OAuth tokens at rest.

### Optional (feature-gated integrations)
- `GEMINI_API_KEY`: Enables AI-assisted URL scraping fallback and photo analysis.
- `BARCODE_LOOKUP_API_KEY`: Enables BarcodeLookup provider (when present) for barcode enrichment.
- `BARCODE_LOOKUP_USER_AGENT`: User-Agent string for free providers (e.g. OpenFoodFacts).
- `UPCITEMDB_USER_KEY`: Enables authenticated UPCitemdb lookups (falls back to trial if absent).
- `UPCITEMDB_KEY_TYPE`: UPCitemdb key type header value (defaults to `3scale`).

## Ralph Team Loop v2
- Init: `./scripts/ralph-team-v2/init.sh --project-url "https://github.com/orgs/Arda-cards/projects/14" --repo-type backend`
- Planner: `./scripts/ralph-team-v2/run-planner.sh --prd ./docs/prd/onboarding-port.md --backlog ./docs/onboarding/ralph-backlog.md --max-iterations 10`
- Team: `./scripts/ralph-team-v2/run-team.sh --max-iterations 20`
- Reviewer: `./scripts/ralph-team-v2/run-reviewer.sh --max-iterations 10`
