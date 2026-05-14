/**
 * Worker key resolver — pluggable A/B abstraction.
 *
 * MODE A (default): single service-owned hot wallet from WORKER_PK env.
 *   All agents share the same worker. Simplest. Used to ship the grant demo.
 *
 * MODE B (future): per-agent worker key, looked up from an encrypted store.
 *   Each agent registers its own worker. Smaller blast radius.
 *
 * Switch modes by setting WORKER_KEY_MODE=A|B. Routes never change — they
 * just ask `getWorkerForAgent(agentId)` and get back a viem Account + addr.
 *
 * IMPORTANT — the on-chain contract `JobEscrow.submitDeliverable` requires
 * `msg.sender == job.worker`. So whichever mode is active, the address
 * returned here MUST match the `worker` field that the client passed when
 * calling `JobEscrow.createJob(agentId, worker, evaluator, spec)`.
 *
 * For mode A, that means the frontend must use `NEXT_PUBLIC_WORKER_ADDR`
 * (which is the public address derived from `WORKER_PK`) when creating
 * jobs. We sanity-check this on startup.
 */

import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { getAddress, type Hex } from 'viem';

export type WorkerSigner = {
  account: PrivateKeyAccount;
  address: Hex;
};

let cached: WorkerSigner | null = null;

/**
 * Resolve the worker signer for a given agent.
 *
 * In Mode A, agentId is ignored (single service worker). In Mode B, the
 * implementation will swap to per-agent lookup without changing callers.
 */
export function getWorkerForAgent(_agentId: string | bigint): WorkerSigner {
  const mode = process.env.WORKER_KEY_MODE ?? 'A';

  if (mode !== 'A') {
    throw new Error(
      `worker_key_mode_unsupported: WORKER_KEY_MODE=${mode} not implemented yet. Only mode A is shipped.`,
    );
  }

  if (cached) return cached;

  const pk = process.env.WORKER_PK;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error(
      'worker_pk_missing: env WORKER_PK must be a 0x-prefixed 32-byte hex private key.',
    );
  }

  const account = privateKeyToAccount(pk as Hex);
  const address = account.address;

  // Sanity check: NEXT_PUBLIC_WORKER_ADDR (frontend) must match WORKER_PK (server).
  // Mismatch means the client put a different worker into createJob() and
  // submitDeliverable will revert with "Not worker". Fail fast at startup.
  const declared = process.env.NEXT_PUBLIC_WORKER_ADDR;
  if (declared) {
    try {
      const declaredCk = getAddress(declared);
      const derivedCk = getAddress(address);
      if (declaredCk !== derivedCk) {
        throw new Error(
          `worker_addr_mismatch: NEXT_PUBLIC_WORKER_ADDR=${declaredCk} but WORKER_PK derives to ${derivedCk}. Frontend will create jobs with a worker the server cannot sign for.`,
        );
      }
    } catch (e) {
      // getAddress throws on invalid checksum — re-raise with context.
      throw new Error(
        `worker_addr_invalid: ${(e as Error).message}`,
      );
    }
  }

  cached = { account, address };
  return cached;
}

/**
 * Returns the public worker address the server expects to be set as
 * `job.worker` on chain. Used by /run handler to refuse jobs whose
 * worker doesn't match (would revert anyway, but we want a clean 4xx).
 */
export function getWorkerAddress(agentId: string | bigint): Hex {
  return getWorkerForAgent(agentId).address;
}
