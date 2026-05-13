# @arclayer/sdk

Typed TypeScript helpers for building on ArcLayer testnet. The SDK wraps the live ArcLayer contracts with viem-ready ABIs, deployed addresses, read helpers, and transaction config builders for agent registration, job escrow, settlement, work proofs, reputation, and the legacy milestone escrow flow.

## Install

```bash
pnpm add @arclayer/sdk viem
# Optional, when using the config builders with React/wagmi:
pnpm add wagmi
```

> During testnet the package is developed from this monorepo. If consuming locally, install from `sdk/` or add the workspace package and run `pnpm --dir sdk build` first.

## Network

| Field | Value |
| --- | --- |
| Chain | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Gas token | USDC |
| Testnet USDC | `0x3600000000000000000000000000000000000000` |

## Quick Start

```ts
import { formatUnits } from "viem";
import { readAgentProfile, readAllJobs, readProject } from "@arclayer/sdk";

const project = await readProject(0n);
const jobs = await readAllJobs();
const profile = await readAgentProfile(1n);

console.log(project.title, project.status);
console.log(`${jobs.length} jobs indexed from JobEscrow`);
console.log(formatUnits(profile.score, 0));
```

## Public Clients and Contracts

The SDK exports a preconfigured Arc testnet viem public client and contract instances:

```ts
import {
  arcTestnet,
  publicClient,
  agentRegistry,
  jobEscrow,
  milestoneEscrow,
  reputationOracle,
  workProof,
} from "@arclayer/sdk";

const blockNumber = await publicClient.getBlockNumber();
const jobCount = await jobEscrow.read.jobCounter();
```

Use these when you need raw contract access. Use the read helpers when you want normalized objects instead of Solidity tuples.

## Read Helpers

```ts
import {
  readAgent,
  readAgentJobs,
  readAgentProfile,
  readAllJobs,
  readJob,
  readProject,
  readProjectMilestones,
  readReputationScore,
  readUserJobs,
  readUserProjects,
  readWorkProof,
  readWorkProofTokenByJobId,
  readWorkProofsByAgent,
} from "@arclayer/sdk";
```

### Jobs

```ts
import { formatUnits, type Address } from "viem";
import { readJob, readUserJobs } from "@arclayer/sdk";

const user = "0x1111111111111111111111111111111111111111" as Address;
const jobIds = await readUserJobs(user);
const firstJob = jobIds.length > 0 ? await readJob(jobIds[0]) : null;

if (firstJob) {
  console.log({
    id: firstJob.id.toString(),
    budget: formatUnits(firstJob.budget, 6),
    deliverableURI: firstJob.deliverableURI,
    approved: firstJob.approved,
  });
}
```

### Agent Profile

```ts
import { readAgentProfile } from "@arclayer/sdk";

const profile = await readAgentProfile(1n);

console.log({
  controller: profile.agent.controller,
  reputationScore: profile.score.toString(),
  jobCount: profile.jobs.length,
  proofCount: profile.proofs.length,
});
```

### Legacy Milestone Escrow

```ts
import { formatUnits } from "viem";
import { readProject, readProjectMilestones } from "@arclayer/sdk";

const project = await readProject(0n);
const milestones = await readProjectMilestones(project.id, project.milestoneCount);

console.log(project.title, formatUnits(project.totalAmount, 6));
console.table(
  milestones.map((milestone) => ({
    id: milestone.id.toString(),
    title: milestone.title,
    amount: formatUnits(milestone.amount, 6),
    status: milestone.status,
  }))
);
```

## Write Config Builders

The SDK does not own private keys. Instead, it returns strongly typed viem/wagmi transaction configs that your app signs with its wallet client.

```ts
import { parseUnits, type Address } from "viem";
import {
  buildApproveUsdcConfig,
  buildCreateJobConfig,
  buildEvaluateJobConfig,
  buildFundJobConfig,
  buildRegisterAgentConfig,
  buildSetBudgetConfig,
  buildSettleJobConfig,
  buildSubmitDeliverableConfig,
} from "@arclayer/sdk";

const worker = "0x2222222222222222222222222222222222222222" as Address;
const evaluator = "0x3333333333333333333333333333333333333333" as Address;
const budget = parseUnits("25", 6);

const registerAgent = buildRegisterAgentConfig(
  1n,
  "typescript-auditor",
  "ipfs://bafy.../agent.json"
);

const createJob = buildCreateJobConfig(
  1n,
  worker,
  evaluator,
  "Audit the payment routing package and return a signed report."
);

const setBudget = buildSetBudgetConfig(1n, budget);
const approveUsdc = buildApproveUsdcConfig(budget);
const fundJob = buildFundJobConfig(1n, budget);
const submitDeliverable = buildSubmitDeliverableConfig(
  1n,
  "ipfs://bafy.../deliverable.json",
  "ipfs://bafy.../proof.json"
);
const evaluateJob = buildEvaluateJobConfig(1n, true);
const settleJob = buildSettleJobConfig(1n);
```

### With viem Wallet Client

```ts
import { createWalletClient, custom, parseUnits } from "viem";
import { arcTestnet, buildApproveUsdcConfig, buildFundJobConfig } from "@arclayer/sdk";

const walletClient = createWalletClient({
  chain: arcTestnet,
  transport: custom(window.ethereum!),
});

const [account] = await walletClient.getAddresses();
const amount = parseUnits("25", 6);

await walletClient.writeContract({
  account,
  ...buildApproveUsdcConfig(amount),
});

await walletClient.writeContract({
  account,
  ...buildFundJobConfig(1n, amount),
});
```

### With wagmi

```tsx
import { parseUnits } from "viem";
import { useWriteContract } from "wagmi";
import { buildApproveUsdcConfig, buildFundJobConfig } from "@arclayer/sdk";

export function FundJobButton({ jobId }: { jobId: bigint }) {
  const { writeContractAsync, isPending } = useWriteContract();
  const amount = parseUnits("25", 6);

  async function fundJob() {
    await writeContractAsync(buildApproveUsdcConfig(amount));
    await writeContractAsync(buildFundJobConfig(jobId, amount));
  }

  return (
    <button disabled={isPending} onClick={fundJob}>
      {isPending ? "Funding..." : "Fund job"}
    </button>
  );
}
```

## Hashing

`hashProtocolString(value)` trims a UTF-8 string and returns the `keccak256` hash used by `AgentRegistry.registerAgent` and `JobEscrow.createJob`.

```ts
import { hashProtocolString } from "@arclayer/sdk";

const skillHash = hashProtocolString("typescript-auditor");
const jobSpecHash = hashProtocolString("Audit the SDK docs");
```

## Exports

- `CONTRACTS`, `ARC_CHAIN_ID`, `ARC_EXPLORER`, `ZERO_ADDRESS`
- `ARC_RPC_URLS`, `arcTestnet`, `publicClient`
- Contract instances: `milestoneEscrow`, `agentRegistry`, `jobEscrow`, `workProof`, `reputationOracle`
- ABIs: `MILESTONE_ESCROW_ABI`, `AGENT_REGISTRY_ABI`, `JOB_ESCROW_ABI`, `WORK_PROOF_ABI`, `REPUTATION_ORACLE_ABI`, `USDC_ABI`
- Read helpers and tuple normalizers from `client.ts`
- Write config builders and `hashProtocolString` from `writes.ts`
- Event and tuple types from `types.ts`

## Production Notes

- Treat contract state as canonical; indexers and app caches should only accelerate reads.
- USDC amounts should be handled as `bigint`; use `parseUnits(value, 6)` and `formatUnits(value, 6)` for token values.
- Validate `chainId === 5042002` before sending transactions.
- Store long job specs, deliverables, and proof metadata offchain; put content-addressed URIs onchain.
- Never pass user input directly into transaction builders without app-level authorization and validation.
