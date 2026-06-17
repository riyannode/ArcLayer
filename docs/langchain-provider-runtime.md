# LangChain Provider Runtime

ERC-8183 provider runtime tools for `@arclayer/langchain-adapter`.

## Overview

Provider agents run ERC-8183 jobs through ArcLayer Runner. The adapter exposes two tools:

| Tool | Runner Endpoint | Behavior |
|------|----------------|----------|
| `arclayer_provider_run_only` | `POST /erc8183/provider/run-only` | Runtime only — dispatches job to LLM, returns `deliverableHash`. Does NOT submit on-chain. |
| `arclayer_provider_run_and_submit` | `POST /erc8183/provider/run-and-submit` | Full lifecycle — runs job + submits deliverable on-chain via Circle CLI. |

**`run-only` is the default recommended path.** Use `run-and-submit` only when on-chain settlement is explicitly required.

**Do NOT use `POST /erc8183/provider/run`** — it is a backward-compatible wrapper that delegates to `runAndSubmit`. It exists for legacy clients only.

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

Both tools accept the same input shape, which matches Runner's `Erc8183ProviderJobSchema`:

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

The adapter schema is a superset of `Erc8183ProviderRunJobInputSchema` from `@arclayer/runner-core` — it adds `evaluator?` and `metadata?` to match the HTTP body shape that Runner actually parses.

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

## Role Configuration

The `provider` role includes:

| Tool | Available |
|------|-----------|
| `arclayer_x402_inspect` | ✅ |
| `arclayer_receipts` | ✅ |
| `arclayer_spend_ledger` | ✅ |
| `arclayer_provider_run_only` | ✅ |
| `arclayer_provider_run_and_submit` | ✅ |
| `arclayer_x402_pay` | ❌ |
| `arclayer_x402_batch_pay` | ❌ |

Other roles (`read-only`, `x402-agent`, `evaluator`, `client`) do NOT include provider tools.

## SDK-Side Guardrails

Provider tools have no SDK-side financial guardrails because they perform runtime execution, not payment:

- No `maxAmountUsdc` — provider tools don't transfer funds directly
- No host validation — provider tools call Runner, not external URLs
- No idempotency key — different schema, not applicable

Runner remains the trust boundary for provider operations. Policy enforcement (job ownership, budget limits, role authorization) happens server-side.

## Usage Example

```ts
import { createArcLayerLangChainAgent } from "@arclayer/langchain-adapter";

const agent = createArcLayerLangChainAgent({
  role: "provider",
  model: "openai:gpt-4o",
  runnerUrl: process.env.ARCLAYER_RUNNER_URL!,
  runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
});

const result = await agent.invoke({
  messages: [
    {
      role: "user",
      content: "Run provider job 123 for task task-abc with input {prompt: 'summarize'}",
    },
  ],
});
```

## PM2 Deployment

```bash
# .env
ARCLAYER_RUNNER_URL=http://127.0.0.1:8787
ARCLAYER_RUNNER_SECRET=your-secret-here
OPENAI_API_KEY=sk-...

pm2 start dist/index.js --name arclayer-provider-agent
```

See `agents/examples/langchain-provider-agent` for a complete PM2-compatible example.

## Safety

- `run-only` is the default recommended path — no on-chain side effects
- `run-and-submit` must be explicitly chosen — it submits deliverables on-chain
- Never use `/erc8183/provider/run` (backward-compat wrapper to runAndSubmit)
- All execution goes through Runner HMAC — no direct Circle CLI, no internal imports
- Error messages are sanitized — secrets, tokens, and signatures are redacted
