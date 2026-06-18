## Summary

Remove Circle CLI from the Runner execution path. Circle Dev Wallet is now the only wallet execution rail. Add x402/gateway support through Circle Dev Wallet adapter and `@circle-fin/x402-batching`. Wire spend policy enforcement into the ExecutionGateway. Restore deleted MCP test coverage.

## Architecture

```
RunnerServices → wallet-adapter-factory → CircleDevWalletAdapter → Circle SDK API
```

All wallet writes go through **ExecutionGateway** (idempotency, locks, receipts, operation journal, spend policy enforcement). Secrets never reach LangChain/MCP tool context.

## Changes

### Source Fixes
- **`services.ts`** — Added `spendLedger` (SpendLedger) declaration and initialization. Wired `policyGuard` into ExecutionGateway constructor for spend policy enforcement. Pass `idempotencyKey` to `wallet.payService()` in `payX402()`. Cleaned manifest capabilities: removed `circle_cli_adapter`, conditionally advertise `x402_nanopayment`/`batch_payment` only when `wallet.payService` is available.
- **`wallet-adapter-factory.ts`** — Circle Dev Wallet is the only rail. Circle CLI has been removed.

### Test Strategy
- **Restored `mcp-stdio.test.ts`** — MCP executor unit tests: health, policy, role enforcement, tool filtering. Uses `services.wallet.*` (not `services.circle.*`). No real Circle API calls.
- **Restored `runner-mcp-e2e.test.ts`** — Full MCP transport chain tests: SDK client → server → broker → executor → handler. Role filtering, proxy routing, max call enforcement, error sanitization, structuredContent, audit logging. No real Circle API calls.
- **Cleaned `execution-gateway.test.ts`** — Renamed `makeMockCircle()` → `makeTestWallet()`, `makeMockWalletExecuteResult()` → `makeWalletExecuteResult()`. Updated test names: "Circle CLI throws" → "wallet adapter throws", etc.
- **Cleaned `services.test.ts`** — Replaced stale Circle CLI references in test names and comments with "wallet adapter" equivalents.
- **Cleaned `wallet-adapter-factory.test.ts`** — Renamed mock class to `StubCircleDevWalletAdapter` to clarify constructor-boundary stub.

### Config

| Env Var | Config Field | Required | Default |
|---------|-------------|----------|---------|
| `ARCLAYER_WALLET_RAIL` | `walletRail` | No | `circle-dev` |
| `CIRCLE_API_KEY` | `circleApiKey` | Yes | — |
| `CIRCLE_ENTITY_SECRET` | `circleEntitySecret` | Yes | — |
| `CIRCLE_WALLET_SET_ID` | `circleWalletSetId` | No | — |
| `CIRCLE_WALLET_ID` | `circleWalletId` | Yes | — |
| `CIRCLE_WALLET_ADDRESS` | `circleWalletAddress` | Yes | — |
| `CIRCLE_API_BASE_URL` | `circleApiBaseUrl` | No | Circle default |

### Naming Cleanup
- `submitDeliverableViaCircleCli` → `submitDeliverableViaWallet`
- `registerIdentityViaCircleCli` → `registerIdentityViaWallet`
- `this.circle` → `this.wallet` (services + gateway)
- Manifest capability: `circle_dev_wallet_adapter` (only)

## Security

Secrets (`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_ID`, `CIRCLE_WALLET_SET_ID`, entitySecretCiphertext, bearer tokens, private keys) are:
- ❌ Never exposed to LangChain tool descriptions
- ❌ Never logged in receipts or stdout
- ❌ Never included in error messages (redacted by `sanitizeError`)
- ❌ Never sent to UI/model context

## What Circle Dev Wallet supports
- ✅ Contract execution (ERC-8183, ERC-8004, ERC-20 approve)
- ✅ Contract reads (viem public client)
- ✅ x402 inspect/pay (`@circle-fin/x402-batching` + `BatchEvmSigner`)
- ✅ Gateway balance (permissionless REST `/v1/balances`)
- ✅ Gateway deposit (Circle SDK)
- ✅ Wallet status, wallet balance

## Tests
- **13 tests** for CircleDevWalletAdapter (constructor validation, ERC-8183 allowlist, ERC-8004 register blocking, optional methods)
- **4 tests** for wallet adapter factory (rail selection, missing config errors)
- **218 tests** for runner-core (all pass)
- **MCP stdio tests** restored: executor unit tests for health, policy, role enforcement
- **MCP e2e tests** restored: full transport chain, role filtering, proxy routing, error sanitization, broker enforcement
- **execution-gateway tests** cleaned: adapter-neutral naming
- **services tests** cleaned: adapter-neutral naming

## Live Circle Validation
- Local-only, not committed. Run manually with real Circle env:
  ```
  CIRCLE_API_KEY='***' CIRCLE_ENTITY_SECRET='***' CIRCLE_WALLET_ID='...' CIRCLE_WALLET_ADDRESS='0x...' \
    pnpm exec tsx /tmp/arclayer-live-balance.ts
  ```
- CI/default `pnpm test` does not call Circle API and does not require Circle secrets.

## Validation
- ✅ `@arclayer/circle-dev-wallet-adapter` build
- ✅ `@arclayer/circle-dev-wallet-adapter` test
- ✅ `@arclayer/runner` build
- ✅ `@arclayer/runner` test
- ✅ No Circle CLI dependency reintroduced
- ✅ No stale Circle CLI test names/comments
- ✅ Deleted MCP coverage restored
- ✅ No default unit test calls real Circle API
