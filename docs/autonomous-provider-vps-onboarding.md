# Autonomous Provider VPS Onboarding

One-command installation for a production ARC testnet autonomous provider.

## Prerequisites

- Ubuntu 22.04+ / Debian 12+ VPS (minimum 2GB RAM)
- Root or sudo access
- ARC testnet USDC in your Circle Dev Wallet (https://faucet.circle.com)
- Circle Console API credentials (API key, entity secret, wallet set/ID/address)
- ArcLayer MCP token (from Console dashboard)

## Quick Start

```bash
bash scripts/install-autonomous-provider.sh \
  --mcp-base-url https://arclayers.xyz \
  --mcp-token YOUR_MCP_TOKEN \
  --runner-secret YOUR_RUNNER_SECRET_32CHARS_MIN \
  --openai-api-key sk-... \
  --circle-api-key YOUR_CIRCLE_API_KEY \
  --circle-entity-secret YOUR_ENTITY_SECRET \
  --wallet-set-id YOUR_WALLET_SET_ID \
  --wallet-id YOUR_WALLET_ID \
  --wallet-address 0x... \
  --agent-name "Agent Jumbo" \
  --auto-mint-identity
```

## What It Does

1. Installs Node.js 22, pnpm, PM2
2. Clones/updates ArcLayer repo to `/opt/arclayer`
3. Builds SDK, `runner-core`, `circle-dev-wallet-adapter`, `langchain-adapter`, `runner`, `langchain-runtime-server`
4. Writes `.env.runner` and `.env.langchain-runtime`
5. Ensures ERC-8004 identity (mints if `--auto-mint-identity` and missing)
6. Patches `ARCLAYER_AGENT_ID` with confirmed ERC-8004 tokenId
7. Starts 3 PM2 services (only if identity is confirmed):
   - `arclayer-langchain-runtime` — LangChain runtime server (port 8788)
   - `arclayer-runner` — Runner HTTP API (port 8787)
   - `arclayer-provider` — Autonomous provider worker

## Agent Identity Semantics

| Field | Env Var | Description | Example |
|-------|---------|-------------|---------|
| Agent Name | `ARCLAYER_AGENT_NAME` | Human-readable public name | `Agent Jumbo` |
| Agent Slug | `ARCLAYER_AGENT_SLUG` | Local safe alias (display only) | `agent-jumbo` |
| Agent ID | `ARCLAYER_AGENT_ID` | **ERC-8004 tokenId** (canonical) | `123` |

**Important:**
- `ARCLAYER_AGENT_ID` is the ERC-8004 NFT `tokenId`, NOT a slugified name.
- The installer writes `ARCLAYER_AGENT_NAME` and `ARCLAYER_AGENT_SLUG` to `.env.runner`.
- `ARCLAYER_AGENT_ID` is patched ONLY after the identity is confirmed on-chain.
- The provider PM2 service will NOT start if `ARCLAYER_AGENT_ID` is missing (identity not confirmed).

## Environment Files

### `.env.runner`

| Variable | Description |
|----------|-------------|
| `ARCLAYER_AGENT_NAME` | Human-readable agent name |
| `ARCLAYER_AGENT_SLUG` | Local safe alias |
| `ARCLAYER_AGENT_ID` | ERC-8004 tokenId (patched after confirmation) |
| `ARCLAYER_DEFAULT_ROLE` | `provider` |
| `ARCLAYER_RUNNER_SECRET` | HMAC secret for Runner HTTP auth |
| `ARCLAYER_MCP_BASE_URL` | Console MCP URL |
| `ARCLAYER_MCP_TOKEN` | MCP authentication token |
| `ARCLAYER_RUNTIME_KIND` | `custom` |
| `ARCLAYER_RUNTIME_ENDPOINT` | `http://127.0.0.1:8788` |
| `CIRCLE_API_KEY` | Circle Dev Wallet SDK API key |
| `CIRCLE_ENTITY_SECRET` | Circle entity secret |
| `CIRCLE_WALLET_SET_ID` | Wallet set ID |
| `CIRCLE_WALLET_ID` | Wallet ID |
| `CIRCLE_WALLET_ADDRESS` | Wallet address (0x...) |
| `CIRCLE_CHAIN` | `ARC-TESTNET` |
| `ARCLAYER_ALLOW_IDENTITY_REGISTER` | `true` |

### `.env.langchain-runtime`

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o` (default) |
| `RUNTIME_PORT` | `8788` |
| `RUNTIME_HOST` | `127.0.0.1` |

## PM2 Management

```bash
# Check status
pm2 status

# View logs
pm2 logs arclayer-provider
pm2 logs arclayer-runner
pm2 logs arclayer-langchain-runtime

# Restart
pm2 restart arclayer-provider

# Stop all
pm2 stop all
```

## Identity

ERC-8004 identity state is stored at:
- `~/.arclayer/runner/identity.json` — confirmed identity
- `~/.arclayer/runner/identity-registration.json` — pending registration
- `~/.arclayer/runner/identity.lock` — prevents double-mint (atomic exclusive create)

Check identity:
```bash
pnpm --filter @arclayer/runner start -- identity status
```

### Identity Lifecycle

1. Installer writes `ARCLAYER_AGENT_NAME` and `ARCLAYER_AGENT_SLUG`
2. Identity ensure runs (`--auto-register` mints ERC-8004 NFT)
3. If pending (tx not yet confirmed), installer prints txHash and exits safely
4. If confirmed, installer patches `ARCLAYER_AGENT_ID=<tokenId>` into `.env.runner`
5. Only then starts PM2 services

### Pending Transaction Finalization

If a previous registration is pending (tx submitted but not confirmed):
- The identity ensure command checks the tx receipt
- If tx succeeded, it extracts the tokenId and writes confirmed identity
- If tx reverted, it marks as failed and allows re-registration
- If tx not yet mined, it reports pending status

## Live Validation

After installation, validate on ARC testnet:

```bash
bash scripts/live-test-autonomous-provider-arc.sh \
  --live-arc-testnet \
  --job-id <EXISTING_JOB_ID>
```

The live test script:
- Requires `--live-arc-testnet` flag (no dry-run mode)
- Requires a real `--job-id` (rejects mock/static data)
- Validates job exists on-chain
- Validates job provider matches local wallet address
- Validates job status is in a valid ERC-8183 lifecycle state
- Uses HMAC-authenticated requests for wallet balance check
- Fails if any check does not pass (never claims success without verification)

Use `--skip-balance-check` to bypass the authenticated wallet balance check.

## Security

- **No private keys**: This script never accepts, stores, or generates private keys.
- **No Circle CLI**: Uses Circle Dev Wallet SDK only.
- **File permissions**: `.env` files are `chmod 600`.
- **HMAC auth**: Runner HTTP API requires HMAC-signed requests.
- **ARC-TESTNET only**: Installer rejects non-testnet chain config.
- **Atomic lock**: Identity lock uses exclusive file creation (no TOCTOU race).
- **ESM-safe**: No dynamic `require("node:fs")` in identity management.
- **Stable idempotency**: Identity mint uses deterministic idempotency key tied to wallet + metadata.
