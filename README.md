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
| `FRONTEND_URL` / `BACKEND_URL` | CORS origin and OAuth callback URL (set both on Vercel / Railway). |
| `SENTRY_DSN` (optional) | When provided, captured errors are sent to Sentry via `@sentry/node`. |
| `ENABLE_COGNITO_SYNC` | Set to `true` to enable the scheduled GitHub → Cognito sync. |
| `COGNITO_SYNC_HOUR` | Optional hour (UTC) at which the scheduled sync should run (default `2`). |

### Frontend environment
- `VITE_API_URL`: base URL for the API (defaults to `http://localhost:3001` in dev). |

### Build & release
1. `npm run build` (frontend) – this runs `tsc -b` and `vite build`. Manual chunking is configured via `vite.config.ts` to keep the bundle sizes small.
2. `npm run build` (server) – compiles the Node API via `tsc` (the `start` script runs the emitted `dist/index.js`).

### Hosting notes (Vercel / Railway)
- Set `FRONTEND_URL` to the deployed Vercel domain so OAuth redirects and CORS match.
- Set `BACKEND_URL` for the OAuth callback in `server/src/routes/auth.ts`.
- Store the Redis URL and Postgres `DATABASE_URL` in the platform secrets; both are required before deploying.
- Ensure `ENABLE_COGNITO_SYNC` is `true` on the instance that should perform the nightly sync and that Redis is reachable so the distributed lock works.

### Monitoring & observability
- When `SENTRY_DSN` is set, Sentry picks up HTTP errors and uncaught exceptions automatically. The API logs the Cognito sync status on startup and reports Redis issues to the server logs.
