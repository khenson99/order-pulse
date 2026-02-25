# backend-integrations (Claude Code)

Focus: external integrations and long-running workflows.

## Scope
- Gmail OAuth + encrypted token storage
- Supplier discovery + job orchestration (restart-safe)
- Accounting connectors (QBO/Xero) behind feature flag

## Definition of done
- OAuth flows complete and refresh works
- Jobs are restart-safe, rate-limit aware
- Clear observability (logs + status endpoints)

