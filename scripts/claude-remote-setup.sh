#!/usr/bin/env bash
# SessionStart hook: prepares a Claude Code cloud session (claude.ai/code) to build this repo.
# Local sessions exit at once; builders on the laptop already have mise and node_modules.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"

log() { echo "[remote-setup] $*" >&2; }

# Node and pnpm from mise.toml, as in CI. Fall back to the image's Node plus corepack if mise can't be fetched.
export PATH="$HOME/.local/bin:$PATH"
if ! command -v mise >/dev/null 2>&1; then
  log "installing mise"
  curl -fsSL https://mise.run | sh >&2 || log "mise install failed; falling back to corepack"
fi

if command -v mise >/dev/null 2>&1 && mise trust --yes >&2 && mise install >&2; then
  TOOL_PATH="$(mise bin-paths | paste -sd: -)"
else
  corepack enable >&2
  TOOL_PATH=""
fi
export PATH="${TOOL_PATH:+$TOOL_PATH:}$PATH"

# Later Bash calls in this session see the same PATH, so `pnpm …` and `mise exec -- pnpm …` both work.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"${TOOL_PATH:+$TOOL_PATH:}\$HOME/.local/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

log "node $(node --version), pnpm $(pnpm --version)"
pnpm install --frozen-lockfile >&2

# Chromium for the e2e suite. Best effort: the environment's network policy may block the download.
pnpm --filter web exec playwright install --with-deps chromium >&2 \
  || log "Playwright browser install failed; e2e tests won't run in this session"
