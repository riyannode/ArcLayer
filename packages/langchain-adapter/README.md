# @arclayer/langchain-adapter

LangChain adapter for ArcLayer Runner — x402 nanopayments, receipts, ledger, and role-scoped external agents.

## What This Package Is

A thin SDK that lets external LangChain agents call ArcLayer Runner through HMAC-protected HTTP endpoints. Runner remains the only execution boundary for payments, wallet policy, receipts, and ledger.

**Architecture:**

```
LangChain Agent → @arclayer/langchain-adapter → HMAC HTTP → ArcLayer Runner → Circle/x402
```

**Not this:**

```
LangChain Agent → import @arclayer/runner/src/* → internal services
```

## Install

```bash
pnpm add @arclayer/langchain-adapter
```

## Quick Start (3 lines)

```ts
import { createArcLayerLangChainAgent } from "@arclayer/langchain-adapter";

const agent = createArcLayerLangChainAgent({
  role: "x402-agent",
  model: "openai:gpt-4o",
  runnerUrl: "http://127.0.0.1:8787",
  runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
  maxAmountUsdc: "0.001",
  allowedHosts: ["arclayers.xyz"],
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Inspect and pay this x402 endpoint if under policy." }],
});
```

## Role-Based Tools

| Role | inspect | pay | batch_pay | receipts | ledger | provider_run_only | provider_run_and_submit |
|------|---------|-----|-----------|----------|--------|-------------------|------------------------|
| `read-only` (default) | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| `x402-agent` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `provider` | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| `evaluator` | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| `client` | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |

Evaluator and client roles will gain ERC-8183 tools in future PRs.

## Provider Runtime

Provider agents can run ERC-8183 jobs through ArcLayer Runner. Two tools are available:

- **`arclayer_provider_run_only`** (default) — runs the job on the LLM runtime, returns `deliverableHash`. Does NOT submit on-chain. Use this as the default execution path.
- **`arclayer_provider_run_and_submit`** (explicit opt-in) — runs the job AND submits the deliverable on-chain via Circle CLI. Requires `enableProviderRunAndSubmit: true`.

**Do NOT use `/erc8183/provider/run`** — it is a backward-compatible wrapper that delegates to `runAndSubmit`. Always use `run-only` or `run-and-submit` explicitly.

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

See [docs/langchain-provider-runtime.md](../../docs/langchain-provider-runtime.md) for full documentation.

## SDK-Side Guardrails

The SDK enforces local safety checks before sending to Runner:

- **`maxAmountUsdc`** — blocks payments exceeding the limit
- **`allowedHosts`** — only pay known hosts
- **`deniedHosts`** — block specific hosts
- **`requireIdempotencyKey`** — force idempotency keys
- **`deniedTools`** — remove specific tools even if role allows them
- **Role-scoped tools** — each role only gets its designated tools

Precedence: `deniedTools > allowedTools > role preset`

Runner remains the final policy boundary. SDK guardrails are a safety net, not a replacement.

## Security Model

- Runner secret is only in env vars
- Never sent to LLM, logs, errors, or tool descriptions
- HMAC-signed requests (METHOD + PATH + TIMESTAMP + NONCE + BODY_SHA256)
- Secrets redacted from all error messages
- Payment tools require a reason for audit
- `txHash: null` means pending, not success

## Low-Level Usage

```ts
import { ArcLayerRunnerClient, createArcLayerLangChainTools } from "@arclayer/langchain-adapter";

// Direct client usage
const client = new ArcLayerRunnerClient({
  runnerUrl: "http://127.0.0.1:8787",
  runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
});

const receipts = await client.listReceipts(50);
const ledger = await client.listLedger(50);
const inspect = await client.inspectX402({ url: "https://example.com/api" });

// Custom tool creation
const tools = createArcLayerLangChainTools({
  runnerUrl: "http://127.0.0.1:8787",
  runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
  role: "x402-agent",
  maxAmountUsdc: "0.001",
});
```

## PM2 Deployment

```bash
# .env
ARCLAYER_RUNNER_URL=http://127.0.0.1:8787
ARCLAYER_RUNNER_SECRET=your-secret-here
ARCLAYER_AGENT_ROLE=x402-agent
ARCLAYER_MAX_AMOUNT_USDC=0.000001
OPENAI_API_KEY=sk-...

pm2 start dist/index.js --name arclayer-langchain-agent
pm2 save
pm2 logs arclayer-langchain-agent
```

## What NOT To Do

- Don't import `@arclayer/runner/src/*` from this package
- Don't call Circle CLI directly from LangChain tools
- Don't execute shell commands from LangChain tools
- Don't expose Runner secrets to model context
- Don't fake payment success, receipts, or tx hashes
- Don't give all tools to all roles
- Don't auto-approve sensitive actions from autonomous agents

## License

MIT
