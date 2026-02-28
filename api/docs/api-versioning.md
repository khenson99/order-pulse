# API Versioning & Backwards-Compatible Change Policy

## Contract Location

The source-of-truth OpenAPI spec lives at `docs/api-contract.yaml`.

## Versioning Scheme

The `info.version` field uses **semver** (`MAJOR.MINOR.PATCH`):

| Bump  | When                                                        |
|-------|-------------------------------------------------------------|
| MAJOR | Removing an endpoint, renaming a field, changing a type     |
| MINOR | Adding a new endpoint, adding an optional field             |
| PATCH | Fixing a typo in a description, adding an example           |

## What Counts as Backwards-Compatible

These changes are safe to ship without a major version bump:

- Adding a **new endpoint** (new path or new HTTP method on existing path)
- Adding a **new optional field** to a request or response body
- Adding a **new enum value** to `ErrorResponse.error.code`
- Adding a **new response status code** to an existing endpoint
- Changing an error `message` string (clients must not match on `message`)

## What Counts as Breaking

These changes require a major version bump:

- Removing or renaming an endpoint
- Removing or renaming a response field
- Changing a field's type (e.g., `string` → `number`)
- Making an optional field required
- Removing an enum value from `ErrorResponse.error.code`
- Changing authentication requirements for an existing endpoint

## Error Code Stability

Error codes in `ErrorResponse.error.code` are part of the public contract:

- **Adding** a new code is a minor change.
- **Removing** a code is a breaking change.
- Error `message` strings are informational and may change at any time. Clients must match on `code`.

## Process

1. All contract changes must update `api-contract.yaml` in the same PR as the implementation.
2. The `info.version` field must be bumped according to the rules above.
3. Contract tests (`src/__tests__/contract.test.ts`) validate that the implementation matches the spec.
