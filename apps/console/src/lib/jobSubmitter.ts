/**
 * jobSubmitter — turn an off-chain agent run into an on-chain Submitted job.
 *
 * Flow:
 *   1. Build canonical deliverable JSON (output + run trace + agentId + jobId).
 *   2. Pin to Pinata → ipfs://<cid> (URI we put on chain as `deliverableURI`).
 *   3. Build a separate proofMetadata JSON (LLM model, latency, tokens, hash).
 *   4. Pin proofMetadata too → ipfs://<cid> (we put on chain as `proofMetadataURI`).
 *   5. Compute keccak256(canonical(deliverable)) so anyone can verify the
 *      pinned object matches what was committed.
 *   6. Sign + send JobEscrow.submitDeliverable(jobId, deliverableURI, proofURI)
 *      from the service worker key. Wait for receipt.
 *   7. Return { txHash, deliverableCid, deliverableUri, deliverableHash, proofUri }.
 *
 * Pre-flight checks:
 *   - jobId exists, status == Funded (2), worker matches our service worker.
 *     Refusing here gives a clean error vs an opaque "Not worker" / "Not
 *     submitable" revert.
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

// JobStatus enum (mirror of contract) — used for pre-flight checks.
const JobStatus = {
  Created: 0,
  Budgeted: 1,
  Funded: 2,
  Submitted: 3,
  Evaluated: 4,
  Settled: 5,
  Cancelled: 6,
} as const;

function makeRpcClients() {
  const transport = fallback(ARC_RPC_URLS.map((url) => http(url, { timeout: 10_000 })));
  const publicClient = createPublicClient({ chain: arcTestnet, transport });
  return { transport, publicClient };
}

/**
 * Read the on-chain job tuple and assert it is in the right state for our
 * service worker to submit a deliverable. Throws with a descriptive code.
 *
 * Tuple layout (matches contract struct order):
 *   [id, agentId, client, worker, evaluator, budget, fundedAmount,
 *    createdAt, jobSpecHash, deliverableURI, proofMetadataURI, approved, status]
 */
async function assertJobReadyForSubmit(args: {
  jobId: bigint;
  expectedWorker: Hex;
}): Promise<{ status: number }> {
  const { publicClient } = makeRpcClients();
  const tuple = (await publicClient.readContract({
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: 'jobs',
    args: [args.jobId],
  })) as readonly unknown[];

  if (!Array.isArray(tuple) || tuple.length < 13) {
    throw new Error(`job_read_invalid: unexpected tuple shape for job ${args.jobId}`);
  }

  const client = tuple[2] as Hex;
  const worker = tuple[3] as Hex;
  const status = Number(tuple[12] as bigint | number);

  if (client === '0x0000000000000000000000000000000000000000') {
    throw new Error(`job_not_found: jobId ${args.jobId} does not exist on chain`);
  }
  if (worker.toLowerCase() !== args.expectedWorker.toLowerCase()) {
    throw new Error(
      `job_worker_mismatch: jobId ${args.jobId} on-chain worker is ${worker}, ` +
        `but our service worker is ${args.expectedWorker}. submitDeliverable would revert.`,
    );
  }
  if (status !== JobStatus.Funded) {
    throw new Error(
      `job_not_submitable: jobId ${args.jobId} status is ${status} (need ${JobStatus.Funded}=Funded). ` +
        `The contract requires Funded → Submitted transition.`,
    );
  }

  return { status };
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

  // 3. Build canonical deliverable JSON (this is what the buyer "bought").
  //    Property order matters for hash reproducibility — JSON.stringify
  //    preserves insertion order in modern JS, and we never re-serialize
  //    on chain (the URI points at this exact CID).
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

  // 5. Build + pin proof metadata (LLM trace, hashes — for reputation later).
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

  // 6. Sign + send submitDeliverable from the worker key.
  const { transport, publicClient } = makeRpcClients();
  const walletClient = createWalletClient({
    chain: arcTestnet,
    transport,
    account: worker.account,
  });

  const txHash = await walletClient.writeContract({
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: 'submitDeliverable',
    args: [args.jobId, pinned.uri, proofPinned.uri],
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 90_000,
  });

  if (receipt.status !== 'success') {
    throw new Error(
      `submit_tx_reverted: jobId ${args.jobId} submitDeliverable reverted in block ${receipt.blockNumber} (tx ${txHash}).`,
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
