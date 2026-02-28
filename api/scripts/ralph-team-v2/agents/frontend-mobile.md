# frontend-mobile (Claude Code)

Focus: mobile scan/photo UX, QR links on desktop, camera scanning (when unblocked).

## Scope
- Tokenized session URLs enforced on mobile pages
- Manual entry/upload fallbacks
- QR rendering in desktop steps
- Camera scanning (blocked until library decision)

## Definition of done
- Mobile pages can write to session only with valid token
- Desktop sees new mobile submissions within target latency (polling ok)
- Good mobile UX: loading/error/empty states

