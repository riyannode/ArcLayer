# LangChain Provider Runtime

ERC-8183 provider runtime tools for `@arclayer/langchain-adapter`.

## Overview

Provider agents run ERC-8183 jobs through ArcLayer Runner. The adapter exposes two tools:

| Tool | Runner Endpoint | Behavior | Availability |
|------|----------------|----------|-------------|
| `arclayer_provider_run_only` | `POST /erc8183/provider/run-only` | Runtime only — dispatches job to LLM, returns `deliverableHash`. Does NOT submit on-chain. | Default |
| `arclayer_provider_run_and_submit` | `POST /erc8183/provider/run-and-submit` | Full lifecycle — runs job + submits deliverable on-chain via Circle CLI. | `enableProviderRunAndSubmit: true` |

**`run-only` is the default recommended path.** Use `run-and-submit` only when on-chain settlement is explicitly required.

**Do NOT use `POST /erc8183/provider/run`** — it is a backward-compatible wrapper that delegates to `runAndSubmit`. It exists for legacy clients only.

## Tool Availability

```
role: "provider"
  → arclayer_provider_run_only          (always)
  → arclayer_provider_run_and_submit    (only with enableProviderRunAndSubmit: true)
  → arclayer_x402_inspect               (always)
  → arclayer_receipts                   (always)
  → arclayer_spend_ledger               (always)
```

`deniedTools` always wins over `enableProviderRunAndSubmit`.

## Usage

```ts
import { createArcLayerLangChainAgent } from "@arclayer/langchain-adapter";

// Default: run-only (no on-chain submit)
const agent = createArcLayerLangChainAgent({
  role: "provider",
  model: process.env.OPENAI_MODEL ?? "openai:gpt-4o",
  runnerUrl: process.env.ARCLAYER_RUNNER_URL!,
  runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
  enableProviderRunAndSubmit: false,
});

// Autonomous submit mode (explicit opt-in)
const agent = createArcLayerLangChainAgent({
  role: "provider",
  model: process.env.OPENAI_MODEL ?? "openai:gpt-4o",
  runnerUrl: process.env.ARCLAYER_RUNNER_URL!,
  runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
  enableProviderRunAndSubmit: true,
});
```

## Architecture

```
LangChain Agent
  → arclayer_provider_run_only / arclayer_provider_run_and_submit
    → ArcLayerRunnerClient.runProviderJobOnly() / runAndSubmitProviderJob()
      → HMAC-signed HTTP POST
        → ArcLayer Runner
          → LLM Runtime (run-only)
          → LLM Runtime + Circle CLI (run-and-submit)
```

All execution goes through Runner HTTP HMAC. The adapter never imports `apps/arclayer-runner/src/*`.

## Input Schema

Both tools accept the same input shape, derived from `Erc8183ProviderJobSchema` in `@arclayer/runner-core`:

```ts
{
  taskId: string;        // Task identifier (required)
  jobId: string;         // ERC-8183 job ID, numeric string (required)
  agentId: string;       // Agent identifier (required)
  provider: string;      // Provider wallet address, 0x... (required)
  evaluator?: string;    // Evaluator wallet address, 0x... (optional)
  description: string;   // Job description (required)
  input: unknown;        // Job input payload, any JSON value (required)
  metadata?: Record<string, unknown>;  // Optional metadata
}
```

The adapter schema reuses `Erc8183ProviderJobSchema` from `@arclayer/runner-core` directly via `.extend()` to avoid schema drift.

## Output Shapes

### run-only

```ts
{
  ok: true;
  status: "completed";
  role: "provider";
  result: unknown;          // LLM runtime output
  deliverableHash: string;  // 0x-prefixed SHA256 of result
  runId: string;            // Internal run identifier
  receipt: unknown;         // Receipt record
}
```

### run-and-submit

```ts
{
  ok: true;
  status: "completed";
  role: "provider";
  result: unknown;
  deliverableHash: string;
  runId: string;
  submitReceipt: unknown;   // On-chain submit receipt (tx hash, etc.)
  receipt: unknown;
}
```

## SDK-Side Guardrails

Provider tools have no SDK-side financial guardrails because they perform runtime execution, not payment:

- No `maxAmountUsdc` — provider tools don't transfer funds directly
- No host validation — provider tools call Runner, not external URLs
- No idempotency key — different schema, not applicable

Runner remains the trust boundary for provider operations. Policy enforcement (job ownership, budget limits, role authorization) happens server-side.

## PM2 Deployment

```bash
# .env
ARCLAYER_RUNNER_URL=http://127.0.0.1:8787
ARCLAYER_RUNNER_SECRET=your-s...n
ENABLE_AUTO_SUBMIT=false

pm2 start dist/index.js --name arclayer-provider-agent
```

See `agents/examples/langchain-provider-agent` for a complete PM2-compatible example.

## Safety

- `run-only` is the default recommended path — no on-chain side effects
- `run-and-submit` requires `enableProviderRunAndSubmit: true` — it submits deliverables on-chain
- `deniedTools` always wins over `enableProviderRunAndSubmit`
- Never use `/erc8183/provider/run` (backward-compat wrapper to runAndSubmit)
- All execution goes through Runner HMAC — no direct Circle CLI, no internal imports
- Error messages are sanitized — secrets, tokens, and signatures are redacted
