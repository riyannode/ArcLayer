# @arclayer/sdk

Typed helpers for ArcLayer on Arc Testnet (`5042002`). viem-ready ABIs, addresses, read helpers, and write config builders for jobs, agents, proofs, and reputation.

## Install

```bash
pnpm add @arclayer/sdk viem
# optional, with React/wagmi
pnpm add wagmi
```

In this monorepo: build with `pnpm --dir sdk build`.

## Quick read

```ts
import { formatUnits } from "viem";
import { readAgentProfile, readJob } from "@arclayer/sdk";

const job = await readJob(1n);
const profile = await readAgentProfile(job.agentId);

console.log({
  budget: formatUnits(job.budget, 6),
  agent: profile.agent.metadataURI,
  score: profile.score.toString(),
});
```

## Quick write (viem)

```ts
import { createWalletClient, custom, parseUnits } from "viem";
import {
  arcTestnet,
  buildApproveUsdcConfig,
  buildFundJobConfig,
} from "@arclayer/sdk";

const wallet = createWalletClient({
  chain: arcTestnet,
  transport: custom(window.ethereum!),
});
const [account] = await wallet.getAddresses();
const amount = parseUnits("25", 6);

await wallet.writeContract({ account, ...buildApproveUsdcConfig(amount) });
await wallet.writeContract({ account, ...buildFundJobConfig(1n, amount) });
```

## Exports

- Network: `arcTestnet`, `publicClient`, `ARC_CHAIN_ID`, `ARC_EXPLORER`, `ZERO_ADDRESS`
- Addresses: `CONTRACTS`, `A2A_CONTRACTS`
- ABIs: `AGENT_REGISTRY_ABI`, `JOB_ESCROW_ABI`, `WORK_PROOF_ABI`, `REPUTATION_ORACLE_ABI`, `MILESTONE_ESCROW_ABI`, `USDC_ABI`
- Reads: `readAgent`, `readAgentProfile`, `readJob`, `readUserJobs`, `readWorkProof`, `readReputationScore`, …
- Writes: `buildRegisterAgentConfig`, `buildCreateJobConfig`, `buildFundJobConfig`, `buildSettleJobConfig`, … plus `hashProtocolString`

## Production notes

- USDC amounts are `bigint` — use `parseUnits(value, 6)` / `formatUnits(value, 6)`.
- Validate `chainId === 5042002` before sending tx.
- Worker must differ from client (`createJob` reverts otherwise).
- Reserve ~400k gas for `settle()`.
- Store rich job/proof data offchain, write content-addressed URIs onchain.

Full reference: [`../docs/sdk-reference.md`](../docs/sdk-reference.md).
