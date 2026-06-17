## Summary

Add Circle Developer-Controlled Wallet support as a **production wallet execution rail** for all ArcLayer Runner wallet actions. Existing Circle CLI support is preserved as the default/dev rail.

## Architecture

```
ARCLAYER_WALLET_RAIL=circle-cli (default)
  RunnerServices → wallet-adapter-factory → CircleCliAdapter → Circle CLI binary

ARCLAYER_WALLET_RAIL=circle-dev
  RunnerServices → wallet-adapter-factory → CircleDevWalletAdapter → Circle SDK API
```

All wallet writes still go through **ExecutionGateway** (idempotency, locks, receipts, operation journal). LangChain never receives Circle secrets.

## Changes

### New Packages
- **`packages/circle-dev-wallet-adapter`** — Circle Dev-Controlled Wallet adapter implementing `WalletExecutionAdapter`
  - Contract execution via `createContractExecutionTransaction` (Circle SDK)
  - Contract reads via viem public client
  - Transaction polling until terminal state
  - Secret redaction in all error paths
  - x402 inspect/pay and Gateway ops return undefined (unsupported by SDK)

### Modified Packages
- **`packages/runner-core`** — `WalletExecutionAdapter` interface + `RunnerConfigSchema` wallet rail fields
- **`packages/circle-cli-adapter`** — `implements WalletExecutionAdapter`, added `signal` params to balance methods
- **`apps/arclayer-runner`** — factory, gateway, services, config, mcp-tools updates

### Config

| Env Var | Config Field | Required | Default |
|---------|-------------|----------|---------|
| `ARCLAYER_WALLET_RAIL` | `walletRail` | No | `circle-cli` |
| `CIRCLE_API_KEY` | `circleApiKey` | Yes (circle-dev) | — |
| `CIRCLE_ENTITY_SECRET` | `circleEntitySecret` | Yes (circle-dev) | — |
| `CIRCLE_WALLET_SET_ID` | `circleWalletSetId` | No | — |
| `CIRCLE_WALLET_ID` | `circleWalletId` | Yes (circle-dev) | — |
| `CIRCLE_WALLET_ADDRESS` | `circleWalletAddress` | Yes (circle-dev) | — |
| `CIRCLE_API_BASE_URL` | `circleApiBaseUrl` | No | Circle default |

### Naming Cleanup
- `submitDeliverableViaCircleCli` → `submitDeliverableViaWallet`
- `registerIdentityViaCircleCli` → `registerIdentityViaWallet`
- `this.circle` → `this.wallet` (services + gateway)
- Manifest capability: `circle_cli_adapter` or `circle_dev_wallet_adapter`

## Security

Secrets (`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_ID`, `CIRCLE_WALLET_SET_ID`, entitySecretCiphertext, bearer tokens, private keys) are:
- ❌ Never exposed to LangChain tool descriptions
- ❌ Never logged in receipts or stdout
- ❌ Never included in error messages (redacted by `sanitizeError`)
- ❌ Never sent to UI/model context

## What circle-dev does NOT support (returns 501)
- x402 `inspectService` — Circle SDK has no x402 protocol support
- x402 `payService` — Circle SDK has no x402 protocol support
- `gatewayDeposit` / `gatewayBalance` — Circle Gateway requires CLI

## Tests
- **13 tests** for CircleDevWalletAdapter (constructor validation, ERC-8183 allowlist, ERC-8004 register blocking, optional methods undefined)
- **4 tests** for wallet adapter factory (rail selection, missing config errors)
- **218 tests** for runner-core (all pass)
- **11 tests** for circle-cli-adapter (all pass)

## Validation
- ✅ `@arclayer/runner-core` build
- ✅ `@arclayer/circle-cli-adapter` build
- ✅ `@arclayer/circle-dev-wallet-adapter` build
- ✅ `@arclayer/runner` build
- ✅ No console build (OOM-safe)
