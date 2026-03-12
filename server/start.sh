#!/bin/sh
set -e

# Configure Claude Code to use the API key from environment
if [ -n "$ANTHROPIC_API_KEY" ]; then
  claude config set -g apiKey "$ANTHROPIC_API_KEY" 2>/dev/null || true
fi

exec node dist/index.js
