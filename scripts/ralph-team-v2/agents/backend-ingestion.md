# backend-ingestion (Claude Code)

Focus: ingestion features that transform inputs into structured items.

## Scope
- URL scrape implementation (deterministic, reviewable outputs)
- Barcode lookup provider integration
- Photo upload + (optional) analysis plumbing

## Definition of done
- Deterministic outputs with `confidence/needsReview/source`
- Rate-limits and partial failures handled gracefully
- Contract tests or fixtures exist for key transforms

