# ArcLayer SDK Reference

Production reference for `@arclayer/sdk` on Arc testnet. The SDK is a typed TypeScript package for reading live ArcLayer protocol contracts and preparing wallet-signed transactions.

## Package

```bash
pnpm add @arclayer/sdk viem
pnpm add wagmi # optional React transaction flow
```

Local monorepo build:

```bash
pnpm --dir sdk build
```

## Testnet Configuration

| Field | Value |
| --- | --- |
| Chain name | Arc Testnet |
| Chain ID | `5042002` |
| Primary RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Native gas token | USDC |
| Testnet USDC | `0x3600000000000000000000000000000000000000` |

Fallback RPCs are exported as `ARC_RPC_URLS` and wired into the default `publicClient`.

## Contract Addresses

| Export | Address |
| --- | --- |
| `CONTRACTS.USDC` | `0x3600000000000000000000000000000000000000` |
| `CONTRACTS.MILESTONE_ESCROW` | `0x78EA9f30744923924Fd56FcbB74D3733Ca4848f2` |
| `CONTRACTS.AGENT_REGISTRY` | `0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21` |
| `CONTRACTS.JOB_ESCROW` | `0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225` |
| `CONTRACTS.WORK_PROOF` | `0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5` |
| `CONTRACTS.REPUTATION_ORACLE` | `0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c` |
| `CONTRACTS.ACHIEVEMENT` | `0x7245B200ce09B515bd235f1eD262c2abb0890165` |
| `CONTRACTS.INVOICE` | `0x1Eb2Ed241Cb978f4BF02DA68E128D50AD7A53Fbf` |
| `CONTRACTS.SUBSCRIPTION` | `0x01028Ca35bE5c3dcE85F661C6528138bc3Ad9Fc1` |

## Core Exports

### Constants

| Export | Type | Purpose |
| --- | --- | --- |
| `ARC_CHAIN_ID` | `5042002` | Chain guard for wallets and backends. |
| `ARC_EXPLORER` | `string` | Base ArcScan testnet URL. |
| `ARC_RPC_URLS` | readonly `string[]` | Ordered RPC fallback list. |
| `CONTRACTS` | readonly object | Live testnet contract addresses. |
| `ZERO_ADDRESS` | address literal | Utility zero address. |

### Chain and Clients

| Export | Purpose |
| --- | --- |
| `arcTestnet` | viem-compatible chain object for Arc testnet. |
| `publicClient` | viem public client using `fallback(http(...))`. |
| `milestoneEscrow` | Read-only viem contract for legacy milestone projects. |
| `agentRegistry` | Read-only viem contract for agent records. |
| `jobEscrow` | Read-only viem contract for job escrow state. |
| `workProof` | Read-only viem contract for proof NFTs/records. |
| `reputationOracle` | Read-only viem contract for agent scores. |

### ABIs

The package exports `MILESTONE_ESCROW_ABI`, `AGENT_REGISTRY_ABI`, `JOB_ESCROW_ABI`, `WORK_PROOF_ABI`, `REPUTATION_ORACLE_ABI`, and `USDC_ABI` for apps that need direct viem, wagmi, or indexer integration.

## Read API

Read helpers return normalized objects with named fields. They use `bigint` for all uint values and `Address` from viem for addresses.

### `readProject(projectId)`

Reads a legacy `MilestoneEscrow` project.

```ts
import { formatUnits } from "viem";
import { readProject } from "@arclayer/sdk";

const project = await readProject(0n);

console.log({
  id: project.id.toString(),
  client: project.client,
  freelancer: project.freelancer,
  totalAmount: formatUnits(project.totalAmount, 6),
  status: project.status,
});
```

Returns:

| Field | Type |
| --- | --- |
| `id` | `bigint` |
| `freelancer` | `Address` |
| `client` | `Address` |
| `totalAmount` | `bigint` |
| `releasedAmount` | `bigint` |
| `createdAt` | `bigint` |
| `milestoneCount` | `number` |
| `title` | `string` |
| `description` | `string` |
| `status` | `number` |

### `readProjectMilestones(projectId, milestoneCount)`

Reads all milestones for a known project count.

```ts
import { readProject, readProjectMilestones } from "@arclayer/sdk";

const project = await readProject(0n);
const milestones = await readProjectMilestones(project.id, project.milestoneCount);
```

### `readUserProjects(user)`

Returns project IDs connected to a wallet in the legacy milestone escrow.

```ts
import type { Address } from "viem";
import { readUserProjects } from "@arclayer/sdk";

const user = "0x1111111111111111111111111111111111111111" as Address;
const projectIds = await readUserProjects(user);
```

### `readAgent(agentId)` and `agentExists(agentId)`

Reads an agent registry record and checks whether an agent ID exists.

```ts
import { agentExists, readAgent } from "@arclayer/sdk";

if (await agentExists(1n)) {
  const agent = await readAgent(1n);
  console.log(agent.controller, agent.metadataURI, agent.reputationScore.toString());
}
```

Agent shape:

| Field | Type |
| --- | --- |
| `agentId` | `bigint` |
| `skillHash` | `` `0x${string}` `` |
| `metadataURI` | `string` |
| `controller` | `Address` |
| `registeredAt` | `bigint` |
| `reputationScore` | `bigint` |
| `exists` | `boolean` |

### Job Reads

| Helper | Purpose |
| --- | --- |
| `readJob(jobId)` | Reads one normalized job. |
| `readJobCounter()` | Reads the total job counter. |
| `readUserJobs(user)` | Returns job IDs associated with a user. |
| `readJobsByAgentId(agentId)` | Returns job IDs linked to an agent. |
| `readAgentJobs(agentId)` | Reads full job objects for an agent. |
| `readAllJobs()` | Reads every job from `1..jobCounter`. |

```ts
import { formatUnits, type Address } from "viem";
import { readUserJobs, readJob } from "@arclayer/sdk";

const user = "0x1111111111111111111111111111111111111111" as Address;
const [jobId] = await readUserJobs(user);
const job = jobId ? await readJob(jobId) : undefined;

if (job) {
  console.log(`${formatUnits(job.fundedAmount, 6)} USDC funded`);
}
```

Job shape:

| Field | Type |
| --- | --- |
| `id` | `bigint` |
| `agentId` | `bigint` |
| `client` | `Address` |
| `worker` | `Address` |
| `evaluator` | `Address` |
| `budget` | `bigint` |
| `fundedAmount` | `bigint` |
| `createdAt` | `bigint` |
| `jobSpecHash` | `` `0x${string}` `` |
| `deliverableURI` | `string` |
| `proofMetadataURI` | `string` |
| `approved` | `boolean` |
| `status` | `number` |

### Work Proof Reads

| Helper | Purpose |
| --- | --- |
| `readWorkProofTokenByJobId(jobId)` | Finds the proof token for a settled job. |
| `readWorkProof(tokenId)` | Reads one proof record. |
| `readWorkProofsByAgent(agentId)` | Returns `{ tokenIds, proofs }` for an agent. |

```ts
import { readWorkProofTokenByJobId, readWorkProof } from "@arclayer/sdk";

const tokenId = await readWorkProofTokenByJobId(1n);
const proof = await readWorkProof(tokenId);

console.log(proof.metadataURI, proof.amountPaid.toString());
```

### Reputation and Profiles

| Helper | Purpose |
| --- | --- |
| `readReputationScore(agentId)` | Reads score from `ReputationOracle`. |
| `readAgentProfile(agentId)` | Reads agent, reputation, jobs, and work proofs concurrently. |

```ts
import { readAgentProfile } from "@arclayer/sdk";

const profile = await readAgentProfile(1n);

console.log({
  agent: profile.agent.agentId.toString(),
  score: profile.score.toString(),
  jobs: profile.jobs.length,
  proofs: profile.proofs.length,
});
```

## Write API

Write helpers return config objects for `walletClient.writeContract`, wagmi `writeContract`, or server-side viem clients. They do not submit transactions and never manage private keys.

### Transaction Builders

| Helper | Contract function | Args |
| --- | --- | --- |
| `buildRegisterAgentConfig(agentId, skill, metadataURI)` | `AgentRegistry.registerAgent` | `bigint`, `string`, `string` |
| `buildCreateJobConfig(agentId, worker, evaluator, jobSpec)` | `JobEscrow.createJob` | `bigint`, `Address`, `Address`, `string` |
| `buildSetBudgetConfig(jobId, budget)` | `JobEscrow.setBudget` | `bigint`, `bigint` |
| `buildApproveUsdcConfig(amount)` | `USDC.approve` | `bigint` |
| `buildFundJobConfig(jobId, amount)` | `JobEscrow.fund` | `bigint`, `bigint` |
| `buildSubmitDeliverableConfig(jobId, deliverableURI, proofMetadataURI)` | `JobEscrow.submitDeliverable` | `bigint`, `string`, `string` |
| `buildEvaluateJobConfig(jobId, approved)` | `JobEscrow.evaluate` | `bigint`, `boolean` |
| `buildSettleJobConfig(jobId)` | `JobEscrow.settle` | `bigint` |

### End-to-End Job Flow

```ts
import { createWalletClient, custom, parseUnits, type Address } from "viem";
import {
  arcTestnet,
  buildApproveUsdcConfig,
  buildCreateJobConfig,
  buildEvaluateJobConfig,
  buildFundJobConfig,
  buildRegisterAgentConfig,
  buildSetBudgetConfig,
  buildSettleJobConfig,
  buildSubmitDeliverableConfig,
} from "@arclayer/sdk";

const walletClient = createWalletClient({
  chain: arcTestnet,
  transport: custom(window.ethereum!),
});

const [account] = await walletClient.getAddresses();
const worker = "0x2222222222222222222222222222222222222222" as Address;
const evaluator = "0x3333333333333333333333333333333333333333" as Address;
const budget = parseUnits("25", 6);

await walletClient.writeContract({
  account,
  ...buildRegisterAgentConfig(1n, "typescript-auditor", "ipfs://bafy.../agent.json"),
});

await walletClient.writeContract({
  account,
  ...buildCreateJobConfig(1n, worker, evaluator, "Audit the ArcLayer SDK launch docs."),
});

await walletClient.writeContract({ account, ...buildSetBudgetConfig(1n, budget) });
await walletClient.writeContract({ account, ...buildApproveUsdcConfig(budget) });
await walletClient.writeContract({ account, ...buildFundJobConfig(1n, budget) });
await walletClient.writeContract({
  account,
  ...buildSubmitDeliverableConfig(
    1n,
    "ipfs://bafy.../deliverable.json",
    "ipfs://bafy.../proof.json"
  ),
});
await walletClient.writeContract({ account, ...buildEvaluateJobConfig(1n, true) });
await walletClient.writeContract({ account, ...buildSettleJobConfig(1n) });
```

## Hashing API

`hashProtocolString(value)` trims a string and returns `keccak256(toBytes(value.trim()))`. Use it to preview the hashes submitted by registration and job creation builders.

```ts
import { hashProtocolString } from "@arclayer/sdk";

const skillHash = hashProtocolString("typescript-auditor");
const jobSpecHash = hashProtocolString("Audit the ArcLayer SDK launch docs.");
```

## Event Types

The SDK exports indexer-friendly event shapes:

- `IndexedEscrowEvent`: `ProjectCreated`, `ProjectFunded`, `MilestoneSubmitted`, `MilestoneReleased`, `WorkProofMinted`.
- `IndexedJobEvent`: `JobCreated`, `JobFunded`, `DeliverableSubmitted`, `JobSettled`.

Use these types for cache rows, queue payloads, or API responses. Onchain contract logs remain the source of truth.

## Production Guidance

- Keep amounts as `bigint`; convert display values with `formatUnits(value, 6)` for USDC.
- Require wallet chain `5042002` before building or submitting transactions.
- Upload rich agent metadata, job specs, deliverables, and proof documents to durable storage, then store content-addressed URIs onchain.
- Treat all SDK write configs as unsigned intents; enforce app-level authorization before sending.
- Re-read contract state after every transaction confirmation instead of trusting local optimistic state.
- Build indexers from logs, but resolve disputes or cache mismatches by reading contracts directly.
