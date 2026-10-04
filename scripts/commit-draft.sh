#!/bin/sh
# Snapshot draft/ onto the local-only `dev-local` branch WITHOUT touching the working branch.
# Uses a throwaway index + commit-tree, so no checkout ever happens and main never sees draft/.
set -e
cd "$(git rev-parse --show-toplevel)"
GIT_DIR="$(git rev-parse --git-dir)"
export GIT_INDEX_FILE="$GIT_DIR/dev-local-index"
trap 'rm -f "$GIT_INDEX_FILE"' EXIT

git read-tree --empty
# -f passes the root /draft/ rule, but git reads no ignore file inside an ignored
# directory, so draft/'s own nested ignores never apply (2026-09-06). The excludes
# below keep installs, builds and caches out of the snapshot (2026-10-04, James's
# word): one spike directory alone had put a 39,108-file cargo target/debug into it.
git add -f -- draft \
  ':(exclude,glob)draft/**/node_modules/**' \
  ':(exclude,glob)draft/**/dist/**' \
  ':(exclude,glob)draft/**/.cache/**' \
  ':(exclude,glob)draft/**/.vite/**' \
  ':(exclude,glob)draft/**/target/**'
tree=$(git write-tree)

msg="${1:-docs: draft snapshot $(date +%Y-%m-%dT%H:%M:%S)}"
if parent=$(git rev-parse -q --verify refs/heads/dev-local); then
  if [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
    echo "dev-local: no draft changes since last snapshot."
    exit 0
  fi
  commit=$(git commit-tree "$tree" -p "$parent" -m "$msg")
else
  commit=$(git commit-tree "$tree" -m "$msg")
fi
git update-ref refs/heads/dev-local "$commit"
echo "dev-local -> $commit"
