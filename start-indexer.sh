#!/bin/bash
cd /root/ArcLayer/indexer
export INDEXER_PORT=3535
export DATABASE_PATH=/root/ArcLayer/indexer/data/arclayer-indexer.sqlite
export ARC_RPC_URL=https://rpc.testnet.arc.network
export POLL_INTERVAL_MS=15000
export FROM_BLOCK=41752050
export MAX_BLOCK_RANGE=10000
exec node --import tsx src/server.ts
