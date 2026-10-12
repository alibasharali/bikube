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
echo "check: all green"
