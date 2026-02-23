#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Not inside a git repository." >&2
  exit 1
fi

current_branch="$(git branch --show-current)"
if [[ -z "$current_branch" ]]; then
  echo "Unable to determine current branch." >&2
  exit 1
fi

ts="$(date +%Y%m%d-%H%M%S)"
backup_branch="codex/wip-backup-${ts}"

if git show-ref --verify --quiet "refs/heads/${backup_branch}"; then
  echo "Backup branch already exists: ${backup_branch}" >&2
  exit 1
fi

if [[ -z "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "Nothing to backup; working tree already clean." >&2
  exit 1
fi

echo "Creating backup branch: ${backup_branch}"
git switch -c "$backup_branch"
git add -A
git commit -m "chore: backup local WIP before cleanup"

echo "Returning to ${current_branch} and cleaning against origin/${current_branch}"
git switch "$current_branch"
git fetch origin
if git show-ref --verify --quiet "refs/remotes/origin/${current_branch}"; then
  git reset --hard "origin/${current_branch}"
else
  echo "Warning: origin/${current_branch} not found; leaving branch as-is before clean." >&2
fi

git clean -fd

echo
echo "Backup complete: ${backup_branch}"
git status --short --branch
