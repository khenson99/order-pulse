#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Not inside a git repository." >&2
  exit 1
fi

status="$(git status --porcelain --untracked-files=all)"
if [[ -n "$status" ]]; then
  echo "Working tree is dirty. Commit/stash/clean before proceeding." >&2
  echo >&2
  echo "$status" >&2
  exit 1
fi

echo "Working tree is clean."
