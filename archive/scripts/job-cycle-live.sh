#!/usr/bin/env bash
# Full Job Cycle: createJob → setBudget → approve USDC → fund → submitDeliverable → evaluate → settle
# This mints a WorkProof NFT on-chain as proof of completed agent work.
#
# Roles:
#   CLIENT    = 0x9dc3f8F2E2Aa59F9300D9B40D16725317F52B074 (creates job, funds, can settle)
#   WORKER    = 0xd5154D79B52A5980e7B0E806F5e4bF3DCa3798b5 (submits deliverable)
#   EVALUATOR = 0xda1d55b30564F7da7e4D19cb2AfDB78c8dA5FA1D (approves work)
#
# Contracts:
#   JobEscrow     = 0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225
#   AgentRegistry = 0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21
#   WorkProof     = 0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5
#   USDC          = 0x3600000000000000000000000000000000000000
#
# Usage: bash scripts/job-cycle-live.sh

set -euo pipefail

CAST=/root/.foundry/bin/cast
RPC=https://rpc.drpc.testnet.arc.network

JOB_ESCROW=0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225
USDC=0x3600000000000000000000000000000000000000
WORK_PROOF=0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5

CLIENT_PK=$(cat /tmp/arclayer_client.pk)
WORKER_PK=$(cat /tmp/arclayer_worker.pk)
EVALUATOR_PK=$(cat /tmp/arclayer_evaluator.pk)

CLIENT=0x9dc3f8F2E2Aa59F9300D9B40D16725317F52B074
WORKER=0xd5154D79B52A5980e7B0E806F5e4bF3DCa3798b5
EVALUATOR=0xda1d55b30564F7da7e4D19cb2AfDB78c8dA5FA1D

# Use agentId=1 (exists in core registry)
AGENT_ID=1
# Budget: 5 USDC (5000000 in 6 decimals)
BUDGET=5000000
# Job spec hash (keccak of "ArcLayer demo job cycle")
JOB_SPEC_HASH=$($CAST keccak "ArcLayer demo job cycle")

echo "═══════════════════════════════════════════"
echo "  ArcLayer Full Job Cycle — Live Execution"
echo "═══════════════════════════════════════════"
echo ""

# Step 1: createJob
echo "▶ Step 1: createJob (client → escrow)"
TX1=$($CAST send $JOB_ESCROW \
  "createJob(uint256,address,address,bytes32)(uint256)" \
  $AGENT_ID $WORKER $EVALUATOR $JOB_SPEC_HASH \
  --private-key $CLIENT_PK --rpc-url $RPC --json | jq -r '.transactionHash')
echo "  tx: $TX1"

# Extract jobId from logs
JOB_ID=$($CAST call $JOB_ESCROW "jobCounter()(uint256)" --rpc-url $RPC)
echo "  jobId: $JOB_ID"
echo ""

# Step 2: setBudget
echo "▶ Step 2: setBudget ($BUDGET = 5 USDC)"
TX2=$($CAST send $JOB_ESCROW \
  "setBudget(uint256,uint256)" \
  $JOB_ID $BUDGET \
  --private-key $CLIENT_PK --rpc-url $RPC --json | jq -r '.transactionHash')
echo "  tx: $TX2"
echo ""

# Step 3: approve USDC spend
echo "▶ Step 3: approve USDC for JobEscrow"
TX3=$($CAST send $USDC \
  "approve(address,uint256)" \
  $JOB_ESCROW $BUDGET \
  --private-key $CLIENT_PK --rpc-url $RPC --json | jq -r '.transactionHash')
echo "  tx: $TX3"
echo ""

# Step 4: fund
echo "▶ Step 4: fund job"
TX4=$($CAST send $JOB_ESCROW \
  "fund(uint256,uint256)" \
  $JOB_ID $BUDGET \
  --private-key $CLIENT_PK --rpc-url $RPC --json | jq -r '.transactionHash')
echo "  tx: $TX4"
echo ""

# Step 5: submitDeliverable (worker)
echo "▶ Step 5: submitDeliverable (worker)"
DELIVERABLE_URI="https://arclayers.xyz/proof/job-${JOB_ID}-deliverable.json"
PROOF_URI="https://arclayers.xyz/proof/job-${JOB_ID}-metadata.json"
TX5=$($CAST send $JOB_ESCROW \
  "submitDeliverable(uint256,string,string)" \
  $JOB_ID "$DELIVERABLE_URI" "$PROOF_URI" \
  --private-key $WORKER_PK --rpc-url $RPC --json | jq -r '.transactionHash')
echo "  tx: $TX5"
echo ""

# Step 6: evaluate (evaluator approves)
echo "▶ Step 6: evaluate (evaluator → approved=true)"
TX6=$($CAST send $JOB_ESCROW \
  "evaluate(uint256,bool)" \
  $JOB_ID true \
  --private-key $EVALUATOR_PK --rpc-url $RPC --json | jq -r '.transactionHash')
echo "  tx: $TX6"
echo ""

# Step 7: settle (mints WorkProof NFT!)
echo "▶ Step 7: settle (client → triggers payout + WorkProof mint)"
TX7=$($CAST send $JOB_ESCROW \
  "settle(uint256)" \
  $JOB_ID \
  --private-key $CLIENT_PK --rpc-url $RPC --json | jq -r '.transactionHash')
echo "  tx: $TX7"
echo ""

# Verify WorkProof was minted
echo "═══════════════════════════════════════════"
echo "  ✓ Job Cycle Complete!"
echo "═══════════════════════════════════════════"
echo ""
echo "  JobId:     $JOB_ID"
echo "  Settle tx: $TX7"
echo ""

# Verify WorkProof was minted. This ERC721 does not expose totalSupply(),
# so use proofTokenByJobId(jobId) and ownerOf(tokenId).
TOKEN_ID=$($CAST call $WORK_PROOF "proofTokenByJobId(uint256)(uint256)" $JOB_ID --rpc-url $RPC)
TOKEN_OWNER=$($CAST call $WORK_PROOF "ownerOf(uint256)(address)" $TOKEN_ID --rpc-url $RPC)
TOKEN_URI=$($CAST call $WORK_PROOF "tokenURI(uint256)(string)" $TOKEN_ID --rpc-url $RPC)
echo "  WorkProof tokenId: $TOKEN_ID"
echo "  WorkProof owner:   $TOKEN_OWNER"
echo "  WorkProof URI:     $TOKEN_URI"
echo ""
echo "  Explorer: https://testnet.arcscan.app/tx/$TX7"
echo ""
