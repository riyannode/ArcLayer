#!/bin/bash
# Provider Direct Mode — no Runner dependency
set -a
source /root/ArcLayer/agents/examples/langchain-provider-agent/.env
set +a
cd /root/ArcLayer
exec pnpm --filter langchain-provider-agent start
