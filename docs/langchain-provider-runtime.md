# LangChain Provider Runtime

ERC-8183 provider runtime tools for `@arclayer/langchain-adapter`.

## Overview

Provider agents run ERC-8183 jobs through ArcLayer Runner. The adapter exposes four provider tools:

| Tool | Runner Endpoint | Behavior | Availability |
|------|----------------|----------|-------------|
| `arclayer_provider_quote_job` | *(adapter-only)* | Estimates complexity and suggests budget. No on-chain call. | Default |
| `arclayer_provider_run_only` | `POST /erc8183/provider/run-only` | Runtime only — dispatches job to LLM, returns `deliverableHash`. Does NOT submit on-chain. | Default |
| `arclayer_provider_run_and_submit` | `POST /erc8183/provider/run-and-submit` | Full lifecycle — runs job + submits deliverable on-chain via Circle CLI. | `enableProviderRunAndSubmit: true` |
| `arclayer_provider_set_budget` | `POST /erc8183/provider/set-budget` | Sets job budget on-chain via Runner. Reason encoded into calldata. | `enableProviderSetBudget: true` |

**`run-only` is the default recommended path.** Use `run-and-submit` only when on-chain settlement is explicitly required.

**Do NOT use `POST /erc8183/provider/run`** — it is a backward-compatible wrapper that delegates to `runAndSubmit`. It exists for legacy clients only.

## Tool Availability

```
role: "provider"
  → arclayer_provider_quote_job          (always — adapter-only, no Runner call)
  → arclayer_provider_run_only           (always)
  → arclayer_provider_run_and_submit     (only with enableProviderRunAndSubmit: true)
  → arclayer_provider_set_budget         (only with enableProviderSetBudget: true)
  → arclayer_x402_inspect                (always)
  → arclayer_receipts                    (always)
  → arclayer_spend_ledger                (always)
```

`deniedTools` always wins over `enableProviderRunAndSubmit` and `enableProviderSetBudget`.

## Provider Complexity Pricing

Provider agents can autonomously assess job complexity and set budgets through ERC-8183 `setBudget(jobId, amount, optParams)`.

### Complexity Mapping

| Complexity | Budget (USDC) |
|-----------|--------------|
| `low`     | 5.00         |
| `medium`  | 15.00        |
| `high`    | 30.00        |

**Hard cap: 30.00 USDC.** No budget above 30.00 will be accepted.

### Workflow

1. **Quote**: Call `arclayer_provider_quote_job` to assess complexity and get a suggested budget.
2. **Set budget**: Call `arclayer_provider_set_budget` with the quoted complexity, amount, and a pricing reason.
3. **Run**: Call `arclayer_provider_run_only` or `arclayer_provider_run_and_submit`.

### Reason Encoding

The `reason` field in `arclayer_provider_set_budget` is **required** and will be encoded into on-chain calldata through `optParams`:

```
setBudget(jobId, amount, optParams)
```

The `optParams` payload (hex-encoded JSON):
```json
{
  "version": 1,
  "type": "provider_budget_reason",
  "complexity": "medium",
  "budgetUsdc": "15.00",
  "reason": "Medium complexity job requiring multi-step reasoning"
}
```

**Do not put secrets, private prompts, API keys, customer private data, or hidden task payloads in the reason.** It becomes public on-chain calldata.

### ERC-8183 ABI

The contract ABI is unchanged: `setBudget(uint256 jobId, uint256 amount, bytes optParams)`. The reason is encoded into the existing `optParams` bytes parameter.

## Usage

```ts
import { createArcLayerLangChainAgent } from "@arclayer/langchain-adapter";

// Default: run-only, quote available (no set-budget)
const agent = createArcLayerLangChainAgent({
  role: "provider",
  model: process.env.OPENAI_MODEL ?? "openai:gpt-4o",
  runnerUrl: process.env.ARCLAYER_RUNNER_URL!,
  runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
});

// Autonomous pricing mode (explicit opt-in)
const agent = createArcLayerLangChainAgent({
  role: "provider",
  model: process.env.OPENAI_MODEL ?? "openai:gpt-4o",
  runnerUrl: process.env.ARCLAYER_RUNNER_URL!,
  runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
  enableProviderSetBudget: true,
  providerPricingPolicy: {
    minBudgetUsdc: "1.00",
    maxBudgetUsdc: "30.00",
    lowComplexityBudgetUsdc: "5.00",
    mediumComplexityBudgetUsdc: "15.00",
    highComplexityBudgetUsdc: "30.00",
  },
});

// Full autonomous mode: pricing + submit
const agent = createArcLayerLangChainAgent({
  role: "provider",
  model: process.env.OPENAI_MODEL ?? "openai:gpt-4o",
  runnerUrl: process.env.ARCLAYER_RUNNER_URL!,
  runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
  enableProviderRunAndSubmit: true,
  enableProviderSetBudget: true,
});
```

## Architecture

```
LangChain Agent
  → arclayer_provider_quote_job
    → (adapter-only: complexity mapping, no network call)

  → arclayer_provider_set_budget
    → ArcLayerRunnerClient.setProviderBudget()
      → HMAC-signed HTTP POST
        → ArcLayer Runner (validates, encodes reason into optParams)
          → services.setBudget(jobId, amount, optParams)
            → Circle CLI → ERC-8183 setBudget() on-chain

  → arclayer_provider_run_only / arclayer_provider_run_and_submit
    → ArcLayerRunnerClient.runProviderJobOnly() / runAndSubmitProviderJob()
      → HMAC-signed HTTP POST
        → ArcLayer Runner
          → LLM Runtime (run-only)
          → LLM Runtime + Circle CLI (run-and-submit)
```

All execution goes through Runner HTTP HMAC. The adapter never imports `apps/arclayer-runner/src/*`. The `quote_job` tool is adapter-only and makes no network calls.

## SDK-Side Guardrails

Provider runtime tools (`run_only`, `run_and_submit`) have no SDK-side financial guardrails because they perform runtime execution, not payment.

Provider pricing tools (`set_budget`) apply SDK-side validation before the network call:

- `amount > 0`
- `amount >= minBudgetUsdc` (default 1.00)
- `amount <= maxBudgetUsdc` (default 30.00)
- `amount <= 30.00` (hard cap)
- `reason` required, max 512 chars
- `complexity` required: low | medium | high

Runner is the final trust boundary and applies its own validation on the HTTP route.

## PM2 Deployment

```bash
# .env
ARCLAYER_RUNNER_URL=http://127.0.0.1:8787
ARCLAYER_RUNNER_SECRET=your-s...n
ENABLE_AUTO_SUBMIT=false
ENABLE_PROVIDER_SET_BUDGET=false

pm2 start dist/index.js --name arclayer-provider-agent
```

See `agents/examples/langchain-provider-agent` for a complete PM2-compatible example.

## Safety

- `quote_job` is adapter-only — no on-chain call, no Runner call, no HMAC
- `set_budget` requires `enableProviderSetBudget: true` — it writes on-chain
- `set_budget` hard caps at 30.00 USDC
- `set_budget` requires a reason that becomes public on-chain calldata
- `run-only` is the default recommended path — no on-chain side effects
- `run-and-submit` requires `enableProviderRunAndSubmit: true` — it submits deliverables on-chain
- `deniedTools` always wins over `enableProviderRunAndSubmit` and `enableProviderSetBudget`
- Never use `/erc8183/provider/run` (backward-compat wrapper to runAndSubmit)
- All execution goes through Runner HMAC — no direct Circle CLI, no internal imports
- Error messages are sanitized — secrets, tokens, and signatures are redacted
- Client still chooses whether to fund after provider budget is set
- Evaluator reason is separate from provider pricing reason
- Deliverable hash is separate from provider pricing reason
