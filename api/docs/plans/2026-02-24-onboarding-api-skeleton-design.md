# Design: Onboarding API Skeleton (Ticket #1)

## Overview
Scaffold the onboarding-api backend service with Cognito JWT auth, tenant resolution, structured logging, and stable error shapes.

## Stack
- **Runtime**: Node.js + TypeScript
- **Framework**: Express
- **JWT**: aws-jwt-verify (official AWS Cognito JWT verification)
- **Logging**: Pino (structured JSON)
- **Testing**: Vitest
- **Build**: tsc (simple, no bundler needed for backend service)

## Directory Structure
```
src/
├── index.ts                  # Entry point, server bootstrap
├── app.ts                    # Express app setup (middleware stack)
├── config.ts                 # Environment config with validation
├── middleware/
│   ├── auth.ts               # Cognito JWT verification + tenant extraction
│   ├── request-id.ts         # X-Request-ID generation/propagation
│   └── error-handler.ts      # Global error handler → stable error shapes
├── routes/
│   └── onboarding.ts         # Placeholder onboarding routes (all auth-gated)
├── types/
│   └── index.ts              # AuthContext, ErrorResponse, etc.
├── lib/
│   └── logger.ts             # Structured JSON logger (pino)
└── __tests__/
    ├── auth.test.ts           # JWT validation + tenant extraction tests
    └── error-handler.test.ts  # Stable error shape tests
```

## Auth Flow
1. Client sends `Authorization: Bearer <accessToken>` + `X-ID-Token: <idToken>`
2. Auth middleware verifies access token via JWKS (Cognito user pool)
3. Decodes ID token for user claims (`sub`, `email`, `custom:tenant`)
4. Attaches typed `AuthContext` to request
5. On failure → 401 with stable error shape

## Tenant Resolution
- Source: `custom:tenant` claim from Cognito ID token
- Attached to `req.auth.tenantId` for downstream use
- Included in all structured log entries

## Error Shape (stable)
```json
{
  "error": {
    "code": "AUTH_INVALID_TOKEN",
    "message": "Human-readable message",
    "requestId": "uuid"
  }
}
```

Error codes: `AUTH_MISSING_TOKEN`, `AUTH_INVALID_TOKEN`, `AUTH_EXPIRED_TOKEN`, `INTERNAL_ERROR`

## Request IDs
- Generated via `crypto.randomUUID()`
- Honors inbound `X-Request-ID` header if present
- Set on response `X-Request-ID` header
- Included in all log entries

## Config (env vars)
- `COGNITO_USER_POOL_ID` (required)
- `COGNITO_CLIENT_ID` (required)
- `AWS_REGION` (default: us-east-1)
- `PORT` (default: 3001)
- `LOG_LEVEL` (default: info)
- `NODE_ENV` (default: development)

## Test Plan
- Unit: JWT validation with mock tokens (valid, expired, missing, malformed)
- Unit: Tenant extraction from ID token claims
- Unit: Error handler produces stable error shapes
- Unit: Request ID generation and propagation
