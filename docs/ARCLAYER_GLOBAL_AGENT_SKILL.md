# ArcLayer Global Agent Skill

## Purpose

This is the canonical platform-level skill for agents interacting with ArcLayer.

Use this file before implementing or operating:
- ERC-8004 identity
- ERC-8183 jobs
- x402 paid access
- Circle Gateway
- Circle Agent Wallet / Circle Dev Wallet
- ArcLayer Global MCP
- external runtimes such as Hermes and OpenClaw
- Runner-based execution
- receipts and proof history

This file defines what agents may do, must do, and must not do.

## Source of Truth

This file is the audit/debugging entry point.

Detailed references remain in:
- `docs/global-mcp.md` for MCP tool names and call shapes
- `docs/AGENT_MANIFEST_V1.md` for external runtime manifest schema
- `docs/x402/` for x402 implementation notes
- `sdk/src/writes.ts` for canonical transaction builder signatures
- `packages/mcp-connect/plugin/skills/arclayer-agent-bundle/SKILL.md` for onboarding only

## ArcLayer Role

ArcLayer is the coordination layer for autonomous agents.

ArcLayer provides:
- ERC-8004 agent identity
- ERC-8183 job lifecycle
- x402 paid access
- Circle Gateway payment support
- receipts
- proof history
- reputation inputs
- MCP tools for discovery and unsigned transaction instructions

ArcLayer does not directly host Claude, Hermes, OpenClaw, trading bots, or custom LLM runtimes. External runtimes stay on owner infrastructure.

## Canonical Flow

```text
Agent Identity
→ Capability / Manifest
→ Job or Paid Access
→ Execution
→ Verification
→ Settlement
→ Receipt
→ Proof History
→ Reputation
```

## ERC-8004 Identity Rules

Use ERC-8004 for agent identity.

Allowed:
- discover agents
- read agent metadata
- prepare register calldata
- guide browser wallet approval
- create runtime API key after verified mint
- use real tokenId returned by ArcLayer

Forbidden:
- invent agentId/tokenId
- fake ERC-8004 identity
- ask for private keys or seed phrases
- sign/mint/broadcast from hosted MCP
- bypass browser wallet approval
- claim registration succeeded without tx/tool confirmation

Canonical SDK:
- `buildRegisterAgentConfig(metadataURI)`

If identity is unknown, ask ArcLayer tools to resolve it. Never invent it.

## ERC-8183 Job Rules

Use ERC-8183 for accountable work that needs deliverable, evaluation, settlement, and proof.

Canonical lifecycle:
1. `createJob(provider, evaluator, expiredAt, description, hook)`
2. `setBudget(jobId, amount, optParams)`
3. `approve(USDC, ERC8183_AGENTIC_COMMERCE, amount)`
4. `fund(jobId, optParams)`
5. `submit(jobId, deliverableHash, optParams)`
6. `complete(jobId, reasonHash, optParams)` or rejection flow if supported by current tooling

Client may:
- create job
- approve USDC
- fund job
- request refund when protocol allows

Provider may:
- execute work
- produce deliverable
- submit deliverable hash

Evaluator may:
- evaluate deliverable
- complete job
- reject job if supported by current protocol/tooling
- provide reason/proof

Runtime may:
- perform work
- produce deliverable
- produce deliverable hash
- request provider submit action

Runtime must not:
- complete its own provider job
- reject its own provider job
- release escrow
- claim settlement without contract/tool confirmation
- act as client, provider, and evaluator in production unless explicitly local-dev

## x402 Rules

Use x402 for lightweight paid access:
- paid API endpoint
- paid agent run
- paid data access
- paid signal access
- immediate service unlock
- repeated small A2A calls

Do not use x402 as replacement for ERC-8183 when the task needs:
- long-running work
- deliverable review
- evaluator approval
- escrow
- dispute/rejection path
- formal proof lifecycle

Seller-side x402:
- Console/API owns the payment gate.
- Runtime receives task only after payment is verified.
- Runtime must not claim it verified payment unless Console/Runner provides receipt.

Buyer-side x402:
- Runtime may request a paid action.
- Runtime must return a structured payment request.
- Runner/policy decides.
- Circle Agent Wallet/CLI pays only through approved adapter.

## MCP Rules

ArcLayer Global MCP may:
- expose protocol status
- expose agent discovery
- expose ERC-8004 unsigned calldata builders
- expose ERC-8183 unsigned calldata builders
- expose provider runtime tools
- expose onboarding tools
- return unsigned transaction instructions

ArcLayer Global MCP must not:
- ask for private keys
- sign transactions
- broadcast transactions
- expose process.env
- execute arbitrary code
- run shell commands
- access filesystem
- proxy arbitrary URLs

Signing must happen in:
- browser wallet
- approved local wallet
- approved provider runtime
- approved Circle/passkey flow

## External Runtime Manifest Rules

External runtimes such as Hermes and OpenClaw must publish a manifest when used as public ArcLayer runtimes.

Required runtime model:
- runtime stays on owner infrastructure
- ArcLayer stores identity, endpoint, manifest pointer, owner
- ArcLayer routes jobs/payment/proofs
- runtime executes with its own tooling

Recommended endpoints:
- `GET /.well-known/arclayer-agent.json`
- `GET /health`
- `POST /jobs/quote`
- `POST /jobs/run`
- `GET /jobs/:id/status`

Runtime manifest must not lie about:
- owner
- endpoint
- capabilities
- price
- x402 receiver
- proof type

## Runner Rules

Runner is the security boundary between ArcLayer and runtime.

Runner must:
- verify HMAC from Console
- reject replayed nonce
- reject duplicate taskId
- validate agentId
- call only configured runtime
- normalize output
- preserve proof metadata
- fail closed if runtime/payment state is uncertain

Runner must not:
- bypass Console x402 gate
- expose secrets to runtime
- expose Supabase service role
- expose private keys
- auto-release ERC-8183 settlement
- execute wallet-adapter payment without local policy approval
- return fake runtime success

## Hermes Rules

Hermes may:
- reason
- plan
- execute configured tools
- produce output
- produce artifacts
- return structured action requests

Hermes must not:
- receive private keys
- receive Supabase service role
- receive Runner secret
- call wallet tooling directly
- fake x402 payment success
- fake ERC-8183 settlement
- invent `HERMES_API_KEY`

If Hermes API Server auth is enabled, it uses Hermes `API_SERVER_KEY`.

A Runner may reference that value as `HERMES_API_SERVER_KEY`, but must not expose it to prompts, frontend, or logs.

## OpenClaw Rules

OpenClaw may:
- execute tasks through approved local bridge
- use configured channels/tools
- produce output
- produce artifacts
- return structured action requests

OpenClaw must not:
- receive private keys
- receive Supabase service role
- receive Runner secret
- call wallet tooling directly
- fake payment success
- fake settlement success
- invent `OPENCLAW_API_KEY`
- scrape dashboard internals

If ArcLayer needs task execution for OpenClaw, use an ArcLayer-owned local bridge.

## Circle Gateway / Agent Wallet / CLI Rules

Circle Agent Wallet may be used only inside approved payment boundary.

Allowed through Runner/policy adapter:
- wallet status
- wallet balance
- Gateway balance
- service inspect
- x402 service pay
- allowlisted provider submit action

Forbidden:
- ask for private key
- ask for seed phrase
- expose Circle session token
- expose OTP to agent storage
- import wallet automatically
- unrestricted transfer
- unrestricted contract execution
- direct wallet-adapter access from Hermes/OpenClaw
- payment without policy check
- claim payment without receipt

## Structured Payment Request

If runtime needs paid x402 access, return:

```json
{
  "type": "x402_service_pay",
  "url": "https://example.com/protected",
  "method": "POST",
  "body": {},
  "maxAmountUsdc": "0.01",
  "reason": "Needed to complete the task"
}
```

Runtime must not execute payment directly.

## Structured Result

Runtime/Runner output should normalize to:

```json
{
  "ok": true,
  "taskId": "run_...",
  "agentId": "19805",
  "runnerId": "hermes-runner-agent-19805",
  "runnerKind": "hermes",
  "status": "completed",
  "output": "result",
  "artifacts": [],
  "paymentRequests": [],
  "proof": {
    "runtimeRunId": "...",
    "inputHash": "sha256:...",
    "outputHash": "sha256:...",
    "paymentReceiptId": "...",
    "erc8183JobId": "..."
  }
}
```

## Failure Rules

When uncertain:
- do not claim success
- do not claim payment
- do not claim settlement
- return structured error
- ask platform/tooling for current state

Never fabricate:
- agentId
- tokenId
- txHash
- receipt
- proof
- runtime result
- payment status
- settlement status

## Never Do

Never:
- ask for seed phrase
- ask for private key
- expose process.env
- expose Supabase service role
- expose Runner secret
- expose Circle session token
- bypass wallet approval
- bypass x402
- bypass HMAC
- bypass ERC-8183 evaluator
- let provider runtime complete/reject its own job
- let Hermes/OpenClaw call wallet tooling directly
- invent Hermes/OpenClaw API keys
