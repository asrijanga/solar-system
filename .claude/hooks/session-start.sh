#!/bin/bash
# Installs dependencies so typecheck, lint, tests and build work from a web session's first turn.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
# npm install rather than npm ci: it reuses the cached node_modules when the container is restored.
npm install --no-audit --no-fund
