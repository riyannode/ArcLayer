# ArcLayer AI Agent Integration Skill

Copy this file into Codex, Cursor, Claude, Kiro, v0, Windsurf, or another AI coding agent when you want that agent to integrate ArcLayer into an existing app.

---

## Prompt / Skill

You are an AI coding agent integrating ArcLayer into an existing app.

ArcLayer gives agent apps two integration paths:

- **Path A — Charge for my API / agent run:** use **x402**. The user pays before a protected endpoint unlocks.
- **Path B — Create accountable agent work:** use **ArcLayer Escrow**. The user creates a job, deposits USDC into the Settlement Vault, approves the deliverable, then settles payout and WorkProof.

Do not mix these labels. ArcLayer Escrow is a trust layer after work assignment, not a third x402 payment method.

---

## Network facts

- Chain: Arc Testnet
- Chain ID: `5042002`
- CAIP-2: `eip155:5042002`
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

## Decision tree

### If the app needs to charge for API access

Use **Path A: x402 paid endpoint**.

User-facing labels:

- `Arc Native Payment` — direct EIP-3009 USDC payment on Arc Testnet.
- `Circle Gateway Payment` — Circle Gateway batched settlement.
- `Payment receipt`
- `Payment completed`
- `Receipt already used protection`
- Put raw payloads, nonces, payment identifiers, and EIP-712 details under `Developer details`.

Required behavior:

1. Protected route returns HTTP `402` with payment requirements.
2. Client signs payment.
3. Client retries with `X-PAYMENT` for Arc Native or `PAYMENT-SIGNATURE` for Circle Gateway.
4. Server verifies and settles through `/api/x402/verify` and `/api/x402/settle`.
5. Protected route unlocks only after a valid payment receipt.

Supported x402 modes:

- Arc Native Payment: `scheme: exact`, EIP-3009, self-hosted settlement.
- Circle Gateway Payment: `scheme: exact`, `extra.name: GatewayWalletBatched`, Circle Gateway facilitator.
- Legacy `arc-escrow` may exist for backward compatibility but should not be marketed as a payment method in new UI.

### If the app needs accountable agent work

Use **Path B: ArcLayer Escrow job flow**.

User-facing labels:

- `Register Agent`
- `Create Job`
- `Approve & Fund Settlement Vault`
- `Submit Work`
- `Approve Work`
- `Settle Payment`
- `Mint WorkProof`
- `Developer details`

Required behavior:

1. Register or select an agent.
2. Create a job with `agentId`, `worker`, `evaluator`, and `taskDescription`.
3. Set budget, approve USDC, and fund the Settlement Vault.
4. Worker submits deliverable.
5. Client/evaluator approves or rejects.
6. Settle payment and mint WorkProof after approval.

---

## Important guardrails

- Do not rename contract functions.
- Do not change deployed contract addresses.
- Do not hardcode private keys.
- Do not commit `.env`, `.env.*`, mnemonics, API keys, service-role keys, Vercel tokens, or private key files.
- Use the connected wallet for client/evaluator actions.
- Prefer label `Client Address` in UI. It maps to the contract param `evaluator`.
- Validate `worker !== connected client` before opening the wallet popup. `createJob` reverts with `Worker is client` if they match.
- Keep protocol jargon out of primary UI. Put raw method names, addresses, payloads, and hashes inside collapsed `Developer details`.
- Prefer indexer APIs for reads and direct contract writes for on-chain actions.
- Let the wallet estimate gas. Do not hardcode settlement gas at `300000`.
- If the app already uses wagmi, viem, ethers, Privy, RainbowKit, ConnectKit, or Reown/AppKit, extend the existing wallet setup. Do not replace it unless asked.

---

## Path A — x402 paid endpoint quickstart

### 1. Add supported payment requirements

Expose a supported endpoint that returns both payment options:

```ts
GET /api/x402/supported
```

Expected options:

```ts
[
  {
    scheme: 'exact',
    network: 'eip155:5042002',
    asset: '0x3600000000000000000000000000000000000000',
    payTo: '<seller>',
    extra: { name: 'ArcNativeExact' }
  },
  {
    scheme: 'exact',
    network: 'eip155:5042002',
    asset: '0x3600000000000000000000000000000000000000',
    payTo: '<seller>',
    extra: { name: 'GatewayWalletBatched' }
  }
]
```

### 2. Route by payment type

Use one verify endpoint and one settle endpoint. Route internally:

```ts
if (isBatchPayment(paymentRequirements)) {
  // Circle Gateway Payment
  return gatewayClient.verify(paymentPayload, paymentRequirements);
}

// Arc Native Payment
return verifyExactPayment(paymentPayload, paymentRequirements);
```

Same pattern for settle.

### 3. Header handling

- Arc Native Payment: read `X-PAYMENT`.
- Circle Gateway Payment: read `PAYMENT-SIGNATURE`.
- Success response: return `PAYMENT-RESPONSE`.

### 4. UX copy

Good copy:

- `Choose payment method`
- `Arc Native Payment — direct on-chain USDC payment on Arc Testnet`
- `Circle Gateway Payment — pay through Circle Gateway batched settlement`
- `Payment completed`
- `Payment receipt confirmed`
- `Receipt already used protection`

Avoid copy:

- `local paymentId ledger`
- `final settlement requires buyer GatewayWallet deposit`
- Raw `isBatchPayment`, `PAYMENT-SIGNATURE`, or `GatewayWalletBatched` in main UI.

---

## Path B — Escrow job flow

### 1. Register agent

```ts
registerAgent(agentId, skillHash, metadataURI)
```

Explain that the connected wallet becomes the agent controller. Show pending tx, confirmed tx, indexer sync, agent ID, controller, metadata URI, and explorer link.

### 2. Create job

```ts
createJob(agentId, worker, evaluator, taskDescription)
```

UX labels:

- `agentId` → `Agent`
- `worker` → `Worker wallet`
- `evaluator` → `Client Address`
- `taskDescription` → `Task description`

Validation:

- `agentId` must be present.
- `worker` must be a valid address.
- `Client Address` must be a valid address.
- `worker !== Client Address`.

Suggested warning:

> Worker and client cannot be the same address. The worker receives payout — use the agent's controller or a dedicated worker wallet.

### 3. Fund Settlement Vault

```ts
setBudget(jobId, amount)
approve(USDC, JOB_ESCROW, amount)
fund(jobId, amount)
```

Copy:

- `Approve & Fund Settlement Vault`
- `The Settlement Vault holds USDC for this job until the client approves work and settlement completes.`

### 4. Submit work

```ts
submitDeliverable(jobId, deliverableURI)
```

Deliverable can be `ipfs://`, `https://`, or another durable URI.

### 5. Approve work

```ts
evaluate(jobId, approved)
```

Label as `Approve Work` / `Reject Work`, not raw `evaluate()`.

### 6. Settle payment

```ts
settle(jobId)
```

Explain that settlement pays the worker and mints a WorkProof NFT.

---

## Indexer reads

Prefer REST/indexer reads for list views, dashboards, and post-tx polling.

Common endpoints:

```txt
GET /api/indexer/overview
GET /api/indexer/jobs
GET /api/indexer/jobs/:id
GET /api/indexer/agents
GET /api/indexer/agents/:id
GET /api/indexer/proofs
GET /api/indexer/job-events
```

After each write, poll the relevant indexer endpoint until the new state appears.

---

## Minimal SDK pattern

```ts
import {
  buildRegisterAgentConfig,
  buildCreateJobConfig,
  buildSetBudgetConfig,
  buildApproveUsdcConfig,
  buildFundJobConfig,
  buildSubmitDeliverableConfig,
  buildEvaluateJobConfig,
  buildSettleJobConfig,
} from '@arclayer/sdk';
```

Use these builders for writes. Keep app-specific UX around them.

---

## Acceptance checklist

- Path A and Path B are explained separately.
- x402 UI shows exactly two payment methods: Arc Native Payment and Circle Gateway Payment.
- Jobs UI does not show x402 as a selectable payment method.
- Escrow is described as a trust layer, not a payment method.
- Main UI uses user-friendly labels.
- Raw contract names and protocol internals are hidden in `Developer details`.
- Wallet actions show pending, confirmed, and indexer-sync states.
- No secrets are committed or printed.
