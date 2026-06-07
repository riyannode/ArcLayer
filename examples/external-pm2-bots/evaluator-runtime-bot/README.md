# ERC-8183 Evaluator Runtime Bot

Live autonomous evaluator bot for ArcLayer ERC-8183 jobs on Arc Testnet.

## What It Does

1. Polls for `Submitted` jobs assigned to `EVALUATOR_ADDRESS`
2. Fetches job detail, deliverable, proof/receipt
3. Runs real LLM evaluation against acceptance criteria
4. Signs `complete()` or `reject()` on-chain when confidence >= threshold
5. Checkpoints all state to prevent duplicate transactions

## ⚠️ Live Mode Warning

This bot signs **real transactions** on Arc Testnet. There is no mock mode, no dry-run mode. Every `complete()` releases escrowed USDC to the provider. Every `reject()` refunds the client. Test thoroughly on non-production jobs before enabling auto-sign.

## Prerequisites

1. **Dedicated evaluator wallet** — Create a new EOA specifically for evaluation. Do NOT reuse client, provider, or main wallet.
2. **Fund evaluator wallet** — Get USDC from https://faucet.circle.com for gas fees.
3. **ERC-8004 identity** — Register the evaluator address as an agent if needed.
4. **MCP token** — Create via ArcLayer console UI or MCP tools.
5. **OpenAI API key** — Or any OpenAI-compatible endpoint.

## Setup

```bash
cd examples/external-pm2-bots/evaluator-runtime-bot
npm install
cp .env.example .env
# Edit .env with your values
```

## PM2 Start

```bash
pm2 start ecosystem.config.cjs
pm2 logs arclayer-evaluator-0xYourAddr
```

## Architecture

```
evaluator-bot.js          ← Main PM2 process (poll loop + signing)
evaluator-engine.js       ← LLM evaluation logic (prompt + schema validation)
shared/
  arclayer-mcp-client.js  ← MCP client (evaluator methods)
  llm-client.js           ← OpenAI-compatible LLM client
  evaluator-signer.js     ← Transaction signing + policy guard
  evaluator-checkpoint.js ← State persistence (.arclayer-evaluator-state.json)
```

## Policy Guard

The signer only allows two function calls on the ERC-8183 contract:
- `complete(jobId, reasonHash, optParams)`
- `reject(jobId, reasonHash, optParams)`

Any other contract, address, or selector is rejected. This prevents accidental or malicious use of the evaluator wallet for non-evaluation actions.

## On-Chain Verification

Before signing, the bot verifies that the on-chain `evaluator` field for the job matches `EVALUATOR_ADDRESS`. This prevents signing on jobs where the evaluator was changed or set to a different address.

## Checkpoint File

`.arclayer-evaluator-state.json` tracks per-job state:
- `submitted_seen` → `evaluation_started` → `evaluation_completed`
- `complete_tx_sent` → `complete_tx_confirmed`
- `reject_tx_sent` → `reject_tx_confirmed`
- `needs_review` / `failed` / `terminal_detected`

Duplicate transactions are prevented: if a job has `txHash` in checkpoint, the bot checks the receipt before retrying.

## Evaluator Signer Modes

| Mode | Status | Description |
|------|--------|-------------|
| `legacy-eoa` | ✅ Works | Uses `EVALUATOR_PRIVATE_KEY` directly |
| `circle-dcw-sca` | 🔜 `not_configured` | Future: Circle Developer Controlled Wallet |
| `agent-wallet-delegated` | 🔜 `not_configured` | Future: Circle Agent Wallet delegation |

Do not set `EVALUATOR_SIGNER_MODE` to anything other than `legacy-eoa` in this PR.

## Environment Variables

See `.env.example` for all configuration options.

**Required:**
- `ARCLAYER_BASE_URL` — ArcLayer MCP endpoint
- `ARCLAYER_MCP_TOKEN` — MCP session token
- `EVALUATOR_ADDRESS` — Dedicated evaluator EOA address
- `EVALUATOR_PRIVATE_KEY` — Evaluator private key (local only)
- `LLM_BASE_URL` — OpenAI-compatible API base URL
- `LLM_API_KEY` — LLM API key

**Optional (with defaults):**
- `EVALUATOR_AUTO_COMPLETE=true` — Auto-sign complete
- `EVALUATOR_AUTO_REJECT=true` — Auto-sign reject
- `EVALUATOR_MIN_CONFIDENCE=0.80` — Minimum confidence threshold
- `EVALUATOR_MAX_JOBS_PER_LOOP=3` — Max jobs per poll cycle
- `POLL_INTERVAL_MS=15000` — Poll interval

## Do NOT Touch

This bot does not modify:
- Contracts
- x402 payment rails
- Client Profile signing bridge
- Provider runtime lifecycle
- ERC-8004 registration
- Circle wallet implementation
- Agent Wallet minting flow
