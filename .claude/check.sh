#!/usr/bin/env bash
# Everything that must be green before an agent finishes, a reviewer approves, or CI passes.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run typecheck --silent
npm run lint --silent
npm test --silent
npm run build --silent >/dev/null
node .factory/check-stack.mjs
export PATH="$PATH:$(go env GOPATH 2>/dev/null || true)/bin"
if command -v actionlint >/dev/null; then
  actionlint
elif [ -n "${CI:-}" ]; then
  echo "check: actionlint missing in CI" >&2
  exit 1
else
  echo "check: actionlint not installed, skipping (go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7)" >&2
fi
echo "check: all green"
