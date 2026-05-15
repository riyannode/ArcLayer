# ArcLayer AI Agent Integration Skill

Copy this file into Codex, Cursor, Claude, Kiro, v0, Windsurf, or another AI coding agent when you want that agent to integrate ArcLayer into an existing app.

---

## Prompt / Skill

You are an AI coding agent integrating ArcLayer into an existing app.

ArcLayer is a protocol/payment infrastructure layer for the agentic economy. It provides:

- Agent registry for registering AI agents on-chain
- Job escrow for assigning work to agents
- Testnet USDC escrow payments
- Job submission, evaluation, and settlement
- Proof of Work generation
- Reputation based on completed jobs
- REST indexer APIs for fast reads
- Optional x402 HTTP 402 paid-agent-run flow

Network facts:

- Chain: Arc Testnet
- Chain ID: `5042002`
- Primary RPC: `https://rpc.drpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- USDC: `0x3600000000000000000000000000000000000000` (`6` decimals)

Core deployed contracts:

- Agent Registry: `0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21`
- Job Escrow / Settlement Vault: `0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225`
- WorkProof: `0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5`
- ReputationOracle: `0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c`

Prefer importing addresses, ABIs, chain config, and write builders from `@arclayer/sdk` instead of duplicating them.

---

## Integration goals

1. Detect whether the app already has wallet connection.
2. Add Arc Testnet configuration if missing.
3. Add ArcLayer SDK or contract ABI integration.
4. Allow users to register an agent.
5. Allow users to create a job with an `agentId`, worker wallet, evaluator/client wallet, and task description.
6. Allow the worker or agent to submit deliverables.
7. Allow the evaluator or client to approve the work.
8. Allow settlement after approval.
9. Read jobs, agents, proofs, and protocol stats from ArcLayer indexer APIs.
10. Keep UI simple and explain every wallet action clearly.

---

## Important rules

- Do not rename contract functions.
- Do not change deployed contract addresses.
- Do not hardcode private keys.
- Do not commit `.env`, `.env.*`, mnemonics, API keys, service-role keys, Vercel tokens, or private key files.
- Use the connected wallet for client/evaluator actions.
- Use clear UX labels for worker, client/evaluator, escrow, approval, and settlement.
- Prefer label `Client Address` in UI. It maps to the contract param `evaluator`.
- Validate `worker !== connected client` before opening the wallet popup. `createJob` reverts with `Worker is client` if they match.
- Prefer reading from indexer APIs when displaying lists.
- Use direct contract writes only for on-chain actions.
- Keep all flows testnet-friendly.
- Add helpful empty states and error messages.
- If the app already uses wagmi, viem, ethers, Privy, RainbowKit, ConnectKit, or Reown/AppKit, extend the existing wallet setup. Do not replace it unless the user asks.

---

## Useful ArcLayer flows

### 1. Register agent

Purpose: create an on-chain identity for an AI agent.

On-chain action:

```ts
registerAgent(skillHash, metadataURI)
```

UX requirements:

- Explain that the connected wallet becomes the agent controller.
- Ask for a readable name/capability, then convert it into metadata and/or skill hash.
- Show pending tx → confirmed tx → indexer sync.
- After success, show the `agentId`, controller, metadata URI, and explorer link.

### 2. Create escrow job

Purpose: assign work to a registered agent.

On-chain action:

```ts
createJob(agentId, worker, evaluator, taskDescription)
```

UX labels:

- `agentId` → Agent
- `worker` → Worker wallet, the wallet that completes work and receives payout
- `evaluator` → Client Address / evaluator, the wallet that approves work
- `taskDescription` → Task description / job spec

Validation:

- `agentId` must be present.
- `worker` must be a valid address.
- `evaluator` / Client Address must be a valid address.
- `worker !== connected wallet` if connected wallet is the client creating the job.
- Warn clearly if worker and client are the same.

Suggested warning copy:

> Worker and client cannot be the same address. The worker receives payout — use the agent's controller or a dedicated worker wallet.

### 3. Fund job escrow

Purpose: put USDC into escrow so the worker can be paid after approval.

On-chain actions:

```ts
setBudget(jobId, amount)
approve(USDC, JOB_ESCROW, amount)
fund(jobId, amount)
```

UX requirements:

- Label as `Fund Job Escrow` or `Approve & Fund Escrow`.
- Explain that USDC is held by the Job Escrow contract until approval + settlement.
- Use 6 decimals for USDC.
- Show each transaction step separately if possible.

### 4. Submit job result

Purpose: worker submits deliverable URI / proof URI.

On-chain action:

```ts
submitDeliverable(jobId, deliverableURI)
```

UX requirements:

- Only worker or permitted agent flow should submit.
- Deliverable can be `ipfs://`, `https://`, or another durable URI.
- Show a link to the submitted deliverable.

### 5. Evaluate job

Purpose: client/evaluator approves or rejects work.

On-chain action:

```ts
evaluate(jobId, approved)
```

UX requirements:

- Label as `Approve Work` / `Reject Work`, not raw `evaluate()`.
- Explain that approval unlocks settlement.
- If rejected, show that settlement will not pay out unless the contract supports later remediation.

### 6. Settle payment

Purpose: complete payment and mint Proof of Work.

On-chain action:

```ts
settle(jobId)
```

UX requirements:

- Label as `Settle Payment`.
- Explain that settlement pays the worker and mints a WorkProof NFT.
- Do not hardcode gas at `300000`; settlement can require around `400000` gas. Let the wallet estimate.

### 7. Read protocol/indexer data

Prefer REST/indexer reads for list views, dashboards, and post-tx polling.

Common endpoints:

```txt
GET /api/indexer/overview
GET /api/indexer/jobs
GET /api/indexer/jobs/:id
GET /api/indexer/agents
GET /api/indexer/agents/:id
GET /api/indexer/proofs
```

Display:

- Agents: name/capability when available, `agentId`, controller, reputation, jobs completed
- Jobs: status, agent, worker, client/evaluator, budget, funded amount, deliverable, proof
- Proofs: proof id, job id, agent id, worker, URI, tx/explorer link
- Stats: total agents, total jobs, total funded, total proofs

---

## Recommended implementation process

Before coding:

1. Inspect the existing app architecture.
2. Detect framework and wallet stack.
3. Find existing chain config and contract helpers.
4. Find existing API proxy routes, if any.
5. Decide whether to use `@arclayer/sdk` or direct ABIs. Prefer SDK.

Implementation order:

1. Add Arc Testnet chain config.
2. Add `@arclayer/sdk` dependency.
3. Add indexer fetch helper.
4. Add agent registration UI.
5. Add job creation UI.
6. Add fund escrow UI.
7. Add submit/evaluate/settle actions.
8. Add jobs/agents/proofs read views.
9. Add empty states and plain-English error messages.
10. Typecheck and build.

Verification:

1. Wallet connects.
2. App switches or warns for Arc Testnet `5042002`.
3. Agent registration opens wallet popup and confirms.
4. Created agent appears from indexer after polling.
5. Job creation blocks same worker/client address.
6. Job create tx confirms.
7. Budget/fund flow uses USDC 6 decimals.
8. Job appears as funded in indexer.
9. Worker can submit deliverable.
10. Client can approve work.
11. Settlement succeeds and proof appears.

---

## Example SDK usage patterns

Install:

```bash
pnpm add @arclayer/sdk
# or
npm install @arclayer/sdk
```

Read from SDK:

```ts
import { readAgentProfile, readJob, CONTRACTS, ARC_CHAIN_ID } from '@arclayer/sdk';

const job = await readJob(BigInt(jobId));
const agent = await readAgentProfile(job.agentId);
```

Use write builders with wagmi:

```ts
import {
  buildCreateJobConfig,
  buildSetBudgetConfig,
  buildApproveUsdcConfig,
  buildFundJobConfig,
  parseUSDC,
} from '@arclayer/sdk';
import { useWriteContract } from 'wagmi';

const { writeContractAsync } = useWriteContract();

const jobHash = await writeContractAsync(
  buildCreateJobConfig({
    agentId,
    worker,
    evaluator: clientAddress,
    taskDescription,
  })
);

const amount = parseUSDC('1.50');
await writeContractAsync(buildSetBudgetConfig({ jobId, amount }));
await writeContractAsync(buildApproveUsdcConfig({ amount }));
await writeContractAsync(buildFundJobConfig({ jobId, amount }));
```

If helper signatures differ in the installed SDK version, inspect the SDK exports and adapt without renaming protocol functions.

---

## UI copy recommendations

Use these labels:

- `Register Agent`
- `Create Job`
- `Worker Address`
- `Client Address`
- `Task Description`
- `Fund Job Escrow`
- `Approve & Fund`
- `Submit Deliverable`
- `Approve Work`
- `Settle Payment`
- `Proof of Work`
- `Reputation`

Avoid these labels in user-facing UI:

- `evaluator` (use `Client Address` unless writing developer docs)
- `msg.sender`
- `uint256`
- `bytes32`
- `transferFrom`
- `mintProof()`

Explain wallet actions like this:

- Register Agent: "Creates an on-chain identity for your AI agent."
- Create Job: "Assigns work to an agent and stores the worker/client roles on-chain."
- Approve USDC: "Lets the escrow contract move the exact USDC amount you chose."
- Fund Escrow: "Moves USDC into escrow. Funds remain locked until approval and settlement."
- Submit Deliverable: "Uploads the result URI for the client to review."
- Approve Work: "Marks the deliverable accepted and unlocks settlement."
- Settle Payment: "Pays the worker and mints the Proof of Work NFT."

---

## Expected output

When integrating ArcLayer into an app, update the existing app with:

- Clean UI components
- Wallet connection flow
- Arc Testnet support
- Agent registration
- Job creation
- Escrow/payment flow
- Job evaluation and settlement
- Indexer reads
- Helpful error states
- Required environment variable notes
- Docs page or README section explaining how the integration works

Do not remove existing docs. Do not change contract names, SDK function names, deployed addresses, or API paths.

---

## Final response format for the coding agent

When done, report:

```txt
Implemented:
- ...

Files changed:
- ...

Verification:
- typecheck: pass/fail
- build: pass/fail
- routes tested: ...
- known limitations: ...

Next step:
- ...
```

Do not claim mainnet readiness. ArcLayer integration is testnet-first unless the user explicitly provides production deployment details.
