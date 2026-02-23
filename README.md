# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Production deployment checklist

### Backend secrets & services
| Name | Description |
| --- | --- |
| `SESSION_SECRET` | Used to sign the Express session cookie. **Must** be stable in production; the server refuses to start when it is missing. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth credentials for Gmail access. |
| `GEMINI_API_KEY` | API key used for AI-assisted order inference. |
| `ARDA_TENANT_ID` | Tenant ID for Arda API calls. |
| `DATABASE_URL` | Postgres connection string (`DATABASE_URL`) with TLS enabled in production. |
| `REDIS_URL` | Used for session storage, job persistence, and the distributed Cognito sync scheduler. Required in production. |
| `POSTMARK_INBOUND_USERNAME` / `POSTMARK_INBOUND_PASSWORD` | HTTP Basic Auth credentials for `/api/inbound/postmark` webhook requests. |
| `INBOUND_CONFIDENCE_THRESHOLD` | Confidence guardrail for auto-syncing forwarded receipts (default `0.78`). |
| `INBOUND_PROCESS_BATCH_SIZE` | Max inbound receipts claimed per worker tick (default `10`). |
| `INBOUND_MAX_RETRIES` | Max transient retry attempts for inbound processing (default `5`). |
| `INBOUND_RETENTION_DAYS` | Days to keep raw inbound email headers/bodies before purge (default `30`). |
| `ENABLE_ACCOUNTING_CONNECTORS` | Feature flag for QuickBooks/Xero integrations (`true` to enable API routes/UI controls). |
| `ACCOUNTING_SYNC_INTERVAL_MINUTES` | Scheduled incremental sync interval in minutes (default `15`). |
| `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` | OAuth credentials for QuickBooks Online. |
| `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN` | HMAC verifier used for `POST /api/integrations/webhooks/quickbooks` signature checks. |
| `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` | OAuth credentials for Xero. |
| `FRONTEND_URL` / `BACKEND_URL` | CORS origin and OAuth callback URL (set both on Vercel / Railway). |
| `SENTRY_DSN` (optional) | When provided, captured errors are sent to Sentry via `@sentry/node`. |
| `ENABLE_COGNITO_SYNC` | Set to `true` to enable the scheduled GitHub → Cognito sync. |
| `COGNITO_SYNC_HOUR` | Optional hour (UTC) at which the scheduled sync should run (default `2`). |

### Frontend environment
- `VITE_API_URL`: optional API base URL override. Leave unset in production so the app uses same-origin `/auth` and `/api` rewrites.

### Build & release
1. `npm run build` (frontend) – this runs `tsc -b` and `vite build`. Manual chunking is configured via `vite.config.ts` to keep the bundle sizes small.
2. `npm run build` (server) – compiles the Node API via `tsc` (the `start` script runs the emitted `dist/index.js`).

### Hosting notes (Vercel / Railway)
- Set `FRONTEND_URL` to the deployed Vercel domain so OAuth redirects and CORS match.
- Set `BACKEND_URL` for OAuth callbacks in `server/src/routes/auth.ts` and `server/src/routes/integrations.ts`.
- Store the Redis URL and Postgres `DATABASE_URL` in the platform secrets; both are required before deploying.
- If accounting connectors are enabled, configure QuickBooks webhook delivery to `POST /api/integrations/webhooks/quickbooks`.
- Ensure `ENABLE_COGNITO_SYNC` is `true` on the instance that should perform the nightly sync and that Redis is reachable so the distributed lock works.
- Keep Vercel rewrites for `/auth/*` and `/api/*` enabled so browser requests stay first-party.
- Runbook: if users hit onboarding errors like `Not authenticated`, first verify `VITE_API_URL` was not set to the Railway URL in Vercel.

### Monitoring & observability
- When `SENTRY_DSN` is set, Sentry picks up HTTP errors and uncaught exceptions automatically. The API logs the Cognito sync status on startup and reports Redis issues to the server logs.

## Worktree guardrails

Use these commands to avoid accidental dirty-state drift:

1. `npm run worktree:status`
2. `npm run worktree:check-clean`
3. `npm run worktree:backup-clean`
4. `npm run hooks:install`

Notes:
- `worktree:check-clean` fails if tracked or untracked files are present.
- `worktree:backup-clean` creates a local backup branch (`codex/wip-backup-<timestamp>`), commits all current changes, then resets and cleans the current branch.
- `hooks:install` configures `core.hooksPath=.githooks`.
- The repo hooks block direct commits to `main` by default and block push when the worktree is dirty.
- For emergency commits on `main`, set `ALLOW_MAIN_COMMIT=1` for that command only.
