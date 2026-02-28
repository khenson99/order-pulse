# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Order Pulse is an order intelligence platform that auto-extracts purchase orders from email (Gmail), enriches them with product data (Amazon PA-API, Gemini AI, barcode lookups, URL scraping), and syncs to Arda ERP. The frontend provides an 8-step onboarding wizard; the backend handles integrations, background jobs, and data pipelines.

## Repository Structure

Three deployable units in a single repo:

- **Root (`src/`)** — React 19 + TypeScript SPA (Vite, Tailwind CSS, AG Grid Enterprise)
- **`server/`** — Main Express 4 API (PostgreSQL, Redis, Gemini AI, Gmail API, Playwright)
- **`api/`** — Onboarding microservice (Express 5, Cognito JWT auth, Redis sessions, S3 uploads)

The frontend and server are deployed to Vercel and Railway respectively. The onboarding API is a separate deployment.

## Commands

### Frontend (root)
```bash
npm run dev          # Vite dev server (localhost:5173)
npm run build        # tsc -b && vite build
npm run test         # Vitest (frontend tests)
npm run lint         # ESLint across src/ and server/src/
```

### Server (`server/`)
```bash
cd server
npm run dev              # tsx watch src/index.ts
npm run build            # tsc
npm start                # node dist/index.js
npm run db:migrate       # Run full schema migration
npm run db:migrate:incremental  # Incremental migrations
npm test                 # Vitest (server tests)
```

### Onboarding API (`api/`)
```bash
cd api
npm run dev          # Watch mode (tsc --watch + node --watch)
npm run build        # tsc
npm start            # node dist/index.js
npm test             # Vitest
npm run test:watch   # Vitest watch mode
```

### Git Worktree Management
```bash
npm run worktree:status       # git status --short --branch
npm run worktree:check-clean  # Fails if dirty
npm run worktree:backup-clean # Backup branch + reset
npm run hooks:install         # Set core.hooksPath=.githooks
```

## Architecture

### Frontend (`src/`)

The main UI is an 8-step onboarding wizard orchestrated by `src/views/OnboardingFlow.tsx`:
1. Welcome (Gmail OAuth + Arda sync) → 2. Email scan (supplier selection + Gemini extraction) → 3. Integrations (QB/Xero) → 4. URL scraping → 5. Barcode scanning → 6. Photo capture → 7. CSV upload → 8. Master list review + Arda sync

Post-onboarding views: `InventoryView` (AG Grid table), `JourneyView` (order tree), `CadenceView` (reorder velocity), `Dashboard` (analytics).

State management is plain React hooks (useState/useContext/useCallback). No Redux/Zustand. Session persistence uses localStorage keys prefixed `orderPulse_`.

API client lives in `src/services/api.ts` with namespaced exports (`authApi`, `gmailApi`, `ardaApi`).

### Server (`server/src/`)

Express app with route modules in `server/src/routes/`. Key services:
- `emailExtraction.ts` — Gemini AI extracts structured orders from email HTML
- `urlScraper.ts` — Playwright + jsdom page fetch with metadata extraction
- `jobManager.ts` — In-memory + Redis job queue for email processing
- `inboundReceiptWorker.ts` — Processes forwarded Postmark emails with retry logic
- `syncOrchestrator.ts` — QuickBooks/Xero incremental sync + backfill
- `cognitoScheduler.ts` — Nightly GitHub→Cognito sync with Redis distributed lock

Database: PostgreSQL with schema in `server/src/db/schema.sql`. OAuth tokens are encrypted with AES-256-GCM (`server/src/utils/encryption.ts`).

### Onboarding API (`api/src/`)

Cognito JWT-protected service (except public Gmail callback at `/api/onboarding/gmail/*`). Routes in `api/src/routes/`. Libraries in `api/src/lib/` handle URL scraping (Playwright + Jina fallback), barcode lookup (multi-API fallback), photo analysis (Gemini), and S3 presigned uploads. Sessions stored in Redis with configurable TTL.

Config is Zod-validated in `api/src/config.ts`.

## Key Patterns

- **Gemini AI** is used both client-side (`@google/genai` in frontend) and server-side (`@google/generative-ai` in server) — note the different package names
- **OAuth tokens** (Gmail, QuickBooks, Xero) are stored encrypted in PostgreSQL using AES-256-GCM
- **URL scraping** has a fallback chain: Playwright → jsdom → Jina API
- **Barcode lookup** cascades through multiple APIs (Barcode Lookup, UPCitemdb)
- **Feature flags**: `ENABLE_ACCOUNTING_CONNECTORS`, `ENABLE_COGNITO_SYNC` gate optional integrations
- **Vite manual chunking** splits large deps (genai, recharts, react, lucide) into separate bundles
- **Vercel rewrites** proxy `/auth/*` and `/api/*` to the backend to keep sessions first-party

## Git Hooks

Repo hooks (`.githooks/`) block direct commits to `main` (override with `ALLOW_MAIN_COMMIT=1`) and block push when the worktree is dirty. Run `npm run hooks:install` to activate.

## Testing

All three packages use Vitest. Frontend tests use jsdom + @testing-library/react. Run individual tests with:
```bash
npx vitest run path/to/file.test.ts        # from respective package root
npx vitest run --testNamePattern "pattern"  # filter by test name
```

## Environment

Node 20 required. Key env vars: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `ARDA_TENANT_ID`/`ARDA_API_KEY`, `ENCRYPTION_KEY`. See the Production deployment checklist in README.md for the full list.

## Styling

Tailwind CSS with Arda-branded palette (orange accent `#FC5A29`). Custom utility classes: `arda-glass`, `btn-arda-primary`, `arda-mesh`. Icons from Lucide React via `src/components/Icons.tsx`.
