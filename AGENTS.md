# AGENTS.md

Guide for AI coding agents (Codex, Cursor, Claude, Kiro, v0, Windsurf, etc.) and human developers working **inside** this repository, or **integrating ArcLayer into another app**.

If you only want to integrate ArcLayer from an external app, jump to: [docs/ARCLAYER_INTEGRATION_SKILL.md](./docs/ARCLAYER_INTEGRATION_SKILL.md).

If you want to build an **autonomous agent business** on ArcLayer (signal seller, executor, evaluator, skill marketplace), jump to: [docs/AUTONOMOUS_AGENT_BUSINESS_LOOP_SKILL.md](./docs/AUTONOMOUS_AGENT_BUSINESS_LOOP_SKILL.md).

---

## What ArcLayer is

ArcLayer is a payment + escrow + identity protocol for the **agentic economy**. It is the rails on top of which AI agents take paid jobs, get evaluated, and accrue on-chain reputation.

ArcLayer ships:

- **Agent Registry** — register an AI agent on-chain (controller wallet + skill hash + metadata URI).
- **Job Escrow** — create a job, fund it with USDC, submit deliverable, evaluate, settle.
- **Settlement Vault** — USDC held in escrow per job, paid out only on approval.
- **Proof of Work** — every settled job mints a `WorkProof` NFT as a verifiable receipt.
- **Reputation Oracle** — score per agent, computed from settled jobs.
- **Indexer** — REST API that mirrors all on-chain state for fast UI reads.
- **x402 Facilitator** — HTTP 402 payment-gated agent runs (the protocol's HTTP-native flow).
- **TypeScript SDK** (`@arclayer/sdk`) — typed reads, write builders, ABIs, addresses.

Network: **Arc Testnet**, chain id `5042002`. Explorer: `https://testnet.arcscan.app`. USDC: `0x3600000000000000000000000000000000000000` (6 decimals).

---

## Repo layout (high-signal only)

```
contracts/                     Solidity sources (AgentRegistry, JobEscrow, WorkProof, ...)
sdk/src/                       Canonical SDK source — addresses, ABIs, read/write builders
apps/console/                  Next.js 14 frontend (App Router) — main UI surface
  src/app/                     Routes (/, /agents, /jobs, /protocol, /docs, /api/*)
  src/lib/x402/                x402 facilitator modules
indexer/                       Long-running Node.js event indexer (PM2 on a VPS)
docs/                          Public docs (README, SDK reference, indexing, build plan)
```

UI-name vs contract-name mapping — **always use the UI name in copy, the contract name in code**:

| UI name           | Contract name      |
| ----------------- | ------------------ |
| Agent Registry    | `AgentRegistry`    |
| Settlement Vault  | `JobEscrow`        |
| Proof of Work     | `WorkProof`        |
| Reputation Oracle | `ReputationOracle` |

---

## The main protocol flows

### 1. Register an agent
```
controller wallet  ──registerAgent(skillHash, metadataURI)──▶  AgentRegistry
                              │
                              ▼
                    AgentRegistered(agentId, skillHash, controller, metadataURI)
```
Anyone can register. The connected wallet becomes `controller`. `agentId` is derived deterministically.

### 2. Create + fund a job
```
client wallet  ──createJob(agentId, worker, evaluator, taskDescription)──▶  JobEscrow
client wallet  ──setBudget(jobId, amount)
client wallet  ──approve(JOB_ESCROW, amount)──▶ USDC
client wallet  ──fund(jobId, amount)──▶ JobEscrow            (emits JobFunded)
```
Important contract invariant: `createJob` reverts with `"Worker is client"` if `worker == msg.sender`. Worker MUST be a different address than the connected client.

### 3. Submit + evaluate + settle
```
worker wallet     ──submitDeliverable(jobId, deliverableURI)──▶ JobEscrow
evaluator wallet  ──evaluate(jobId, approved)──▶ JobEscrow
anyone            ──settle(jobId)──▶ JobEscrow
                          │
                          ├──▶ USDC to worker
                          ├──▶ USDC fee to fee owner
                          └──▶ WorkProof.mintProof()  (NFT receipt)
```
`settle()` needs ~400k gas — never hardcode 300k.

### 4. x402 paid agent run (HTTP-native)
```
client  ──POST /api/agents/:id/run                ──▶ 402 PAYMENT-REQUIRED (accepts[])
client  ──createJob → setBudget → approve → fund  ──▶ on-chain
client  ──POST /api/agents/:id/run  X-PAYMENT     ──▶ verify on-chain → run agent → submit deliverable
                                                       (returns 200 + PAYMENT-RESPONSE)
client  ──same X-PAYMENT replay (same resource)   ──▶ 200 cached:true
client  ──same X-PAYMENT, different resource      ──▶ PAYMENT_REPLAY_DIFFERENT_RESOURCE
```

### 5. Reading state (UI / external apps)
Prefer the indexer for lists; reach the chain only for fresh writes.

```
GET /api/indexer/overview            Protocol totals + recent activity
GET /api/indexer/jobs                All jobs, newest first
GET /api/indexer/jobs/:id            Single job + events
GET /api/indexer/agents              All registered agents
GET /api/indexer/agents/:id          Agent profile + jobs + proofs
GET /api/indexer/proofs              All work proofs
```

---

## Important integration rules

These apply to BOTH (a) AI agents editing this repo, and (b) AI agents integrating ArcLayer into another app.

1. **Do not rename contract functions.** They are public ABI. Renames break clients.
2. **Do not change deployed contract addresses.** Source them from `@arclayer/sdk` `CONTRACTS`.
3. **Do not hardcode private keys** anywhere. Use connected wallet (browser) or env-loaded files for backend.
4. **Use the connected wallet** for client / evaluator / worker actions. Never auto-sign on the user's behalf without an explicit click.
5. **Use clear UX labels** — "Worker", "Client", "Escrow", "Approve & Fund", "Evaluate", "Settle". Never expose `evaluator` / `msg.sender` to end-users; the UI label `Client Address` maps to contract param `evaluator`.
6. **Worker ≠ Client.** UIs MUST validate this before opening a wallet popup, otherwise `createJob` reverts and the user wastes gas.
7. **Prefer indexer reads** for lists, dashboards, history. Use direct contract reads only when (a) you just wrote and need immediate confirmation, or (b) you want to verify the indexer.
8. **Use direct contract writes only for on-chain actions** (register, createJob, setBudget, approve, fund, submitDeliverable, evaluate, settle).
9. **Stay testnet-friendly.** Default to Arc Testnet (chain id `5042002`). Bail out clearly if `chainId` differs.
10. **Helpful empty states + error messages.** Show "no agents yet" instead of a blank table; surface chain reverts as plain English ("Worker and client cannot be the same address").

---

## What AI coding agents SHOULD modify

- Pages under `apps/console/src/app/` — `/`, `/agents`, `/jobs`, `/protocol`, `/docs`.
- Components under `apps/console/src/components/`.
- UI styles, copy, accessibility, responsiveness.
- Indexer projection logic, polling intervals (`indexer/src/`).
- Documentation under `docs/` (this folder).
- Add new pages or new SDK helpers if explicitly requested.

## What AI coding agents SHOULD NOT modify

Unless the user explicitly asks:

- **Deployed contract source under `contracts/`** — already on-chain, changing source without redeploy creates drift.
- **`sdk/src/addresses.ts`** — these are live addresses. Treat as read-only.
- **`sdk/src/abi.ts`** — must match deployed contracts byte-for-byte.
- **Function signatures** in `sdk/src/writes.ts` and `sdk/src/chain.ts` — public SDK API.
- **API routes under `apps/console/src/app/api/x402/*`** — consumed by paying clients; treat as a stable API.
- **`apps/console/src/lib/x402/`** — the facilitator. Only touch if explicitly building a new x402 capability; do NOT rebuild inline x402 logic in routes.
- **`indexer/` schema** — adding fields is fine, breaking existing keys (`id` on `/jobs`, `jobId` on `/job-events`) breaks consumers.
- **`.env*`, `apps/console/scripts/arc-e2e-*.mjs`, `qa/`, `qa-output/`, `.agents/`, `skills-lock.json`, `X402_*_PLAN.*`** — local-only, do not commit.

## What AI coding agents MUST NEVER do

- Commit secrets (private keys, mnemonics, API keys, service-role keys, Vercel tokens).
- Print private keys / mnemonics in terminal output, logs, or chat replies.
- Bypass the connected wallet to auto-sign for the user.
- Replace `worker` with `msg.sender` in `createJob` calls. The contract rejects it.
- Hardcode RPC URLs as string literals in components — read from `@arclayer/sdk` `ARC_RPC_URLS`.
- Use ES2020+ `BigInt` literals (`123n`) anywhere under `apps/console` — its tsconfig targets ES5. Use `BigInt('123')`.

---

## How to safely integrate ArcLayer into another app

If you (the AI agent) are integrating ArcLayer into an external Next.js / React / wagmi / viem app, follow this flow. The full copy-paste prompt for downstream agents lives in [docs/ARCLAYER_INTEGRATION_SKILL.md](./docs/ARCLAYER_INTEGRATION_SKILL.md).

1. **Detect existing wallet stack** — wagmi, viem, ethers, RainbowKit, ConnectKit, Privy, Reown/AppKit. Don't replace it; integrate alongside.
2. **Add Arc Testnet** to the chain config if missing.
   - Chain id `5042002`, RPC `https://rpc.drpc.testnet.arc.network` (or fallback list from SDK), explorer `https://testnet.arcscan.app`.
3. **Install the SDK**: `pnpm add @arclayer/sdk` (or `npm install`). Use `CONTRACTS`, ABIs, and write config builders from there.
4. **Use indexer REST for displaying state**:
   - Prod indexer base URL is whatever you've deployed (own indexer + tunnel/proxy) or proxy through your own backend.
   - Endpoints listed in the "Reading state" section above.
5. **Wire up the 5 user-facing actions**:
   - Register agent → `registerAgent(skillHash, metadataURI)`
   - Create job → `createJob(agentId, worker, evaluator, taskDescription)` (validate `worker !== client`)
   - Fund → `setBudget` → `approve` → `fund`
   - Submit deliverable → `submitDeliverable(jobId, uri)` (worker)
   - Evaluate + Settle → `evaluate(jobId, approved)` + `settle(jobId)`
6. **Always show a clear status** — pending tx, mined, indexer-confirmed, settled. Never leave the user staring at a spinner.
7. **Required env vars** (any frontend integrating ArcLayer):
   - `NEXT_PUBLIC_ARC_RPC_URL` (optional, falls back to SDK list)
   - `NEXT_PUBLIC_INDEXER_URL` (optional, defaults to `/api/indexer` if proxying server-side)
   - `INDEXER_INTERNAL_URL` (server-only, points to your indexer host)
   - For x402 paid runs: `ARCLAYER_AGENT_ENDPOINT`, `ARCLAYER_AGENT_API_KEY`, `X402_FACILITATOR_ENABLED`

---

## Build / verify (in-repo)

```bash
# Frontend
cd apps/console
NODE_OPTIONS="--max-old-space-size=4096" npm run build
npx tsc --noEmit

# SDK
cd ../../sdk
npm run build

# Indexer
cd ../indexer
npx tsc --noEmit
```

Before push:
```bash
# Secret scan
git diff --cached | grep -InE '(0x[a-fA-F0-9]{64}|PRIVATE_KEY=|mnemonic|seed)' || echo "clean"

git push origin main   # main → Vercel auto-deploys arcwork → arclayers.xyz
```

---

## Live infrastructure (as of 2026-05-15)

- **Frontend**: Vercel project `arcwork`, custom domain `arclayers.xyz`, alias `arclayer-zeta.vercel.app`.
- **Indexer**: VPS PM2 process `arclayer-indexer` on port 3535, exposed via Cloudflare quick tunnel, proxied through `apps/console/src/app/api/indexer/[[...path]]/route.ts`.
- **x402 facilitator**: Routes `/api/x402/supported`, `/api/x402/verify`, `/api/x402/settle`. Modules under `apps/console/src/lib/x402/`.
- **Last verified end-to-end**: job 19 — register → create → fund → submit → evaluate → settle → WorkProof mint.

---

## When in doubt

- Read `docs/sdk-reference.md` for the SDK contract.
- Read `docs/indexing.md` for the indexer model.
- Read `docs/ARCLAYER_INTEGRATION_SKILL.md` if you are integrating ArcLayer into a different app — that file is the copy-paste prompt for downstream AI coding agents.
- For x402 specifics, read modules under `apps/console/src/lib/x402/` directly. Do not infer behavior from old docs.

If a rule here contradicts a comment in code, the **code wins**. Verify with `tsc`, `npm run build`, and a live `curl` against the deployed routes before claiming something is fixed.
