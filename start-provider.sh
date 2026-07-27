#!/bin/bash
# Provider Direct Mode — no Runner dependency
# Builds once, then runs compiled JS directly (no pnpm lifecycle hooks)
set -a
source /root/ArcLayer/agents/examples/langchain-provider-agent/.env
set +a
cd /root/ArcLayer

# Build deps once
pnpm --filter @arclayer/langchain-adapter build
pnpm --filter langchain-provider-agent build

# Run compiled JS directly — no prestart hooks, no recursion
cd /root/ArcLayer/agents/examples/langchain-provider-agent
exec node dist/index.js
