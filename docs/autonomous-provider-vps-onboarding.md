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
  --agent-name my-provider \
  --auto-mint-identity
```

## What It Does

1. Installs Node.js 22, pnpm, PM2
2. Clones/updates ArcLayer repo to `/opt/arclayer`
3. Builds `runner-core`, `langchain-adapter`, `runner`, `langchain-runtime-server`
4. Writes `.env.runner` and `.env.langchain-runtime`
5. Ensures ERC-8004 identity (mints if `--auto-mint-identity` and missing)
6. Starts 3 PM2 services:
   - `arclayer-langchain-runtime` — LangChain runtime server (port 8788)
   - `arclayer-runner` — Runner HTTP API (port 8787)
   - `arclayer-provider` — Autonomous provider worker

## Environment Files

### `.env.runner`

| Variable | Description |
|----------|-------------|
| `ARCLAYER_AGENT_ID` | Agent identifier |
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
- `~/.arclayer/runner/identity.lock` — prevents double-mint

Check identity:
```bash
node packages/runner/dist/index.js identity status
```

## Live Validation

After installation, validate on ARC testnet:

```bash
bash scripts/live-test-autonomous-provider-arc.sh \
  --live-arc-testnet \
  --job-id <EXISTING_JOB_ID>
```

## Security

- **No private keys**: This script never accepts, stores, or generates private keys.
- **No Circle CLI**: Uses Circle Dev Wallet SDK only.
- **File permissions**: `.env` files are `chmod 600`.
- **HMAC auth**: Runner HTTP API requires HMAC-signed requests.
- **ARC-TESTNET only**: Installer rejects non-testnet chain config.
