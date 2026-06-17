feat(langchain): add provider complexity pricing and set-budget tools — PR 3

Allow provider LangChain agents to autonomously quote ERC-8183 job complexity
and set job budget through Runner, with max budget hard capped at 30 USDC.

## New Tools

| Tool | Type | Behavior |
|------|------|----------|
| `arclayer_provider_quote_job` | Adapter-only | Estimates complexity → budget mapping. No Runner call, no HMAC. |
| `arclayer_provider_set_budget` | Runner HMAC | Sets budget on-chain. Reason encoded into `optParams` calldata. |

## Complexity Pricing

| Complexity | Budget |
|-----------|--------|
| low | 5.00 USDC |
| medium | 15.00 USDC |
| high | 30.00 USDC |

Hard cap: 30.00 USDC. Policy defaults in `DEFAULT_PROVIDER_PRICING_POLICY`.

## Key Design Decisions

- `quote_job` is adapter-only — no Runner endpoint, pure local compute
- `set_budget` calls `POST /erc8183/provider/set-budget` over HMAC
- Reason is required and encoded into ERC-8183 `optParams` hex bytes
- ABI unchanged: `setBudget(jobId, amount, optParams)`
- `enableProviderSetBudget: false` by default — explicit opt-in required
- SDK-side budget validation (min/max/hard cap) before network call
- Runner route validates + encodes reason into optParams before `services.setBudget()`
- `services.setBudget()` unchanged — encoding happens in route handler

## Files Changed (12 files, +1135/-71)

**Adapter (packages/langchain-adapter):**
- `types.ts` — ProviderPricingPolicy, new options, input/output types
- `tool-map.ts` — quote_job (adapterOnly) + set_budget entries
- `roles.ts` — Provider preset + set_budget gating
- `client.ts` — `setProviderBudget()` typed method
- `tools.ts` — Schemas, tool creators, SDK-side budget validation
- `index.ts` — Export new types + DEFAULT_PROVIDER_PRICING_POLICY

**Runner (apps/arclayer-runner):**
- `index.ts` — POST /erc8183/provider/set-budget route

**Runner-core (packages/runner-core):**
- `mcp-input-schemas.ts` — complexity? + reason? on Erc8183SetBudgetInputSchema

**Example + Docs:**
- `agents/examples/langchain-provider-agent/` — Pricing env vars + prompt
- `docs/langchain-provider-runtime.md` — Full pricing documentation

**Tests:**
- `roles.test.ts` — +8 tests for pricing role gating
- `tools.test.ts` — +16 tests for quote_job + set_budget

## Validation

- `corepack pnpm --filter @arclayer/runner-core build` ✅
- `corepack pnpm --filter @arclayer/langchain-adapter typecheck` ✅
- `corepack pnpm --filter @arclayer/langchain-adapter test` ✅ 90/90
- `corepack pnpm --filter @arclayer/langchain-adapter build` ✅
- `corepack pnpm --filter @arclayer/runner build` ✅
