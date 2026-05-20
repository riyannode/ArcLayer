/**
 * jobSubmitter — turn an off-chain agent run into an on-chain Submitted job.
 *
 * Pure Arc reference mode — uses official ERC-8183 AgenticCommerce contract:
 *   1. Build canonical deliverable JSON (output + run trace + agentId + jobId).
 *   2. Pin to Pinata → ipfs://<cid>.
 *   3. Build proof metadata JSON (LLM model, latency, tokens, hash).
 *   4. Pin proofMetadata → ipfs://<cid>.
 *   5. Compute keccak256(canonical(deliverable)) as the deliverable hash.
 *   6. Sign + send ERC-8183 submit(jobId, deliverableHash, optParams)
 *      from the service worker key. Wait for receipt.
 *   7. Return { txHash, deliverableCid, deliverableUri, deliverableHash, proofUri }.
 */

import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  keccak256,
  toBytes,
  type Hex,
} from 'viem';
import { ARC_RPC_URLS, CONTRACTS, JOB_ESCROW_ABI, arcTestnet } from '@arclayer/sdk';
import { getWorkerForAgent } from './workerKeys';
import { pinJSON } from './pinataClient';

export type SubmitResult = {
  txHash: Hex;
  blockNumber: bigint;
  deliverableCid: string;
  deliverableUri: string;
  deliverableHash: Hex;
  proofCid: string;
  proofUri: string;
};

// ERC-8183 job status enum (mirrors contract).
const JobStatus = {
  Created: 0,
  Funded: 1,
  Submitted: 2,
  Completed: 3,
} as const;

function makeRpcClients() {
  const transport = fallback(ARC_RPC_URLS.map((url) => http(url, { timeout: 10_000 })));
  const publicClient = createPublicClient({ chain: arcTestnet, transport });
  return { transport, publicClient };
}

/**
 * Read the on-chain job via ERC-8183 getJob(jobId) and assert it is in the
 * right state for our service worker to submit.
 *
 * ERC-8183 getJob returns:
 *   { id, client, provider, evaluator, description, budget, expiredAt, status, hook }
 */
async function assertJobReadyForSubmit(args: {
  jobId: bigint;
  expectedWorker: Hex;
}): Promise<{ status: number }> {
  const { publicClient } = makeRpcClients();
  const job = (await publicClient.readContract({
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: 'getJob',
    args: [args.jobId],
  })) as {
    id: bigint;
    client: Hex;
    provider: Hex;
    evaluator: Hex;
    description: string;
    budget: bigint;
    expiredAt: bigint;
    status: number;
    hook: Hex;
  };

  if (!job || job.client === '0x0000000000000000000000000000000000000000') {
    throw new Error(`job_not_found: jobId ${args.jobId} does not exist on chain`);
  }
  if (job.provider.toLowerCase() !== args.expectedWorker.toLowerCase()) {
    throw new Error(
      `job_worker_mismatch: jobId ${args.jobId} on-chain provider is ${job.provider}, ` +
        `but our service worker is ${args.expectedWorker}. submit would revert.`,
    );
  }
  if (job.status !== JobStatus.Funded) {
    throw new Error(
      `job_not_submitable: jobId ${args.jobId} status is ${job.status} (need ${JobStatus.Funded}=Funded). ` +
        `The contract requires Funded → Submitted transition.`,
    );
  }

  return { status: job.status };
}

export async function submitDeliverableForRun(args: {
  jobId: bigint;
  agentId: string;
  runId: string;
  input: string;
  output: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  startedAt: number;
  completedAt: number;
}): Promise<SubmitResult> {
  // 1. Resolve worker signer (Mode A → single service worker)
  const worker = getWorkerForAgent(args.agentId);

  // 2. Pre-flight: confirm on-chain state matches expectations.
  await assertJobReadyForSubmit({ jobId: args.jobId, expectedWorker: worker.address });

  // 3. Build canonical deliverable JSON.
  const deliverable = {
    schema: 'arclayer.deliverable.v1',
    agentId: args.agentId,
    jobId: args.jobId.toString(),
    runId: args.runId,
    input: args.input,
    output: args.output,
    completedAt: args.completedAt,
  };
  const deliverableCanonical = JSON.stringify(deliverable);
  const deliverableHash = keccak256(toBytes(deliverableCanonical));

  // 4. Pin deliverable to IPFS.
  const pinned = await pinJSON({
    name: `arclayer-deliverable-job${args.jobId}-run${args.runId.slice(0, 10)}`,
    content: deliverable,
    keyvalues: {
      jobId: args.jobId.toString(),
      agentId: args.agentId,
      kind: 'deliverable',
    },
  });

  // 5. Build + pin proof metadata.
  const proofMetadata = {
    schema: 'arclayer.proof.v1',
    agentId: args.agentId,
    jobId: args.jobId.toString(),
    runId: args.runId,
    deliverableCid: pinned.cid,
    deliverableHash,
    model: args.model,
    tokensUsed: args.tokensUsed,
    latencyMs: args.latencyMs,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    worker: worker.address,
  };
  const proofPinned = await pinJSON({
    name: `arclayer-proof-job${args.jobId}-run${args.runId.slice(0, 10)}`,
    content: proofMetadata,
    keyvalues: {
      jobId: args.jobId.toString(),
      agentId: args.agentId,
      kind: 'proof',
    },
  });

  // 6. Sign + send ERC-8183 submit(jobId, deliverableHash, optParams).
  const { transport, publicClient } = makeRpcClients();
  const walletClient = createWalletClient({
    chain: arcTestnet,
    transport,
    account: worker.account,
  });

  const txHash = await walletClient.writeContract({
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: 'submit',
    args: [args.jobId, deliverableHash, '0x' as Hex],
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 90_000,
  });

  if (receipt.status !== 'success') {
    throw new Error(
      `submit_tx_reverted: jobId ${args.jobId} submit reverted in block ${receipt.blockNumber} (tx ${txHash}).`,
    );
  }

  return {
    txHash,
    blockNumber: receipt.blockNumber,
    deliverableCid: pinned.cid,
    deliverableUri: pinned.uri,
    deliverableHash,
    proofCid: proofPinned.cid,
    proofUri: proofPinned.uri,
  };
}
