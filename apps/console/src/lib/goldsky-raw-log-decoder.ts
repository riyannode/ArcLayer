/**
 * Goldsky raw EVM log decoder.
 *
 * Decodes raw log rows from Goldsky Supabase tables into typed event objects.
 * Tables store raw EVM log fields (id, block_number, block_hash, transaction_hash,
 * transaction_index, log_index, address, data, topics, block_timestamp, _gs_op).
 *
 * This module decodes topics and data into structured ERC-8004 and ERC-8183 events
 * that can be fed into existing SDK projection helpers.
 *
 * Topic hashes verified against actual Arc Testnet chain data via eth_getLogs.
 *
 * SERVER-ONLY — uses no browser APIs, no client imports.
 *
 * @module apps/console/src/lib/goldsky-raw-log-decoder
 */

// ── Event signature hashes (topic[0]) — verified from chain data ──────────

/** ERC-721 Transfer(from, to, tokenId) — used by ERC-8004 Identity Registry. */
const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** ERC-8004 IdentityRegistry NewRegistered(tokenId). */
const ERC8004_NEW_REGISTERED_TOPIC =
  "0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7";

/** ERC-8004 IdentityRegistry AgentRegistered(tokenId, controller, metadataURI). */
const ERC8004_AGENT_REGISTERED_TOPIC =
  "0x2c149ed548c6d2993cd73efe187df6eccabe4538091b33adbd25fafdb8a1468b";

/** ERC-8004 IdentityRegistry AgentWallet(tokenId, wallet). */
const ERC8004_AGENT_WALLET_TOPIC =
  "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";

/** ERC-8183 JobCreated(jobId, client, provider, expiredAt, hook, evaluator). */
const ERC8183_JOB_CREATED_TOPIC =
  "0xb0f0239bfdd96453e24733e18bfc24b70d8fadf123dd977473518dd577ee79b9";

/** ERC-8183 BudgetSet(jobId, amount). */
const ERC8183_BUDGET_SET_TOPIC =
  "0x869e2577b006bf47ee981cf6fec2e25583548081c14b98deab587f77b5068038";

/** ERC-8183 JobFunded(jobId, client, amount). */
const ERC8183_JOB_FUNDED_TOPIC =
  "0xe3fbcc1ea1bdc559ec7f0347efde7655e58b5f45a30b0e4470a583c3ef5496b3";

/** ERC-8183 JobSubmitted(jobId, worker, deliverable). */
const ERC8183_JOB_SUBMITTED_TOPIC =
  "0x80c17db79857f338a6a6df68a6883ecc0ce78e2202fe61ed979733573f40538e";

/** ERC-8183 JobCompleted(jobId, evaluator, reason). */
const ERC8183_JOB_COMPLETED_TOPIC =
  "0x0fd54bd364fa9e67f17b091aefe930932c09fe7651cf5ad02c71a418f3341444";

/** ERC-8183 JobRejected(jobId, rejector, reason). */
const ERC8183_JOB_REJECTED_TOPIC =
  "0x21d71db5be59bb9fa133895586b7404307dd33fb93b16db09dc6f1d9d7d231b0";

/** ERC-8183 JobExpired(jobId). */
const ERC8183_JOB_EXPIRED_TOPIC =
  "0x97237956f8810192811e2c3f273fd02c5d6295206fdd9c62e6fe2bfc19ba9232";

// ── Raw log row type ────────────────────────────────────────────────────────

/** Raw EVM log row as stored by Goldsky in Supabase tables. */
export type RawLogRow = {
  id: string;
  block_number: string | number;
  block_hash: string;
  transaction_hash: string;
  transaction_index: string | number;
  log_index: string | number;
  address: string;
  data: string;
  topics: string; // comma-separated hex topic hashes
  block_timestamp: string | number;
  _gs_op?: string;
  created_at?: string;
};

// ── Decoded event types ─────────────────────────────────────────────────────

export type DecodedTransfer = {
  kind: "Transfer";
  from: string;
  to: string;
  tokenId: bigint;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedNewRegistered = {
  kind: "NewRegistered";
  tokenId: bigint;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedAgentRegistered = {
  kind: "AgentRegistered";
  tokenId: bigint;
  controller: string;
  metadataURI: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedAgentWallet = {
  kind: "AgentWallet";
  tokenId: bigint;
  wallet: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedIdentityEvent =
  | DecodedTransfer
  | DecodedNewRegistered
  | DecodedAgentRegistered
  | DecodedAgentWallet;

export type DecodedJobCreated = {
  kind: "JobCreated";
  jobId: bigint;
  client: string;
  provider: string;
  evaluator: string;
  expiredAt: bigint;
  hook: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedBudgetSet = {
  kind: "BudgetSet";
  jobId: bigint;
  amount: bigint;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedJobFunded = {
  kind: "JobFunded";
  jobId: bigint;
  client: string;
  amount: bigint;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedJobSubmitted = {
  kind: "JobSubmitted";
  jobId: bigint;
  worker: string;
  deliverable: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedJobCompleted = {
  kind: "JobCompleted";
  jobId: bigint;
  evaluator: string;
  reason: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedJobRejected = {
  kind: "JobRejected";
  jobId: bigint;
  rejector: string;
  reason: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedJobExpired = {
  kind: "JobExpired";
  jobId: bigint;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedJobEvent =
  | DecodedJobCreated
  | DecodedBudgetSet
  | DecodedJobFunded
  | DecodedJobSubmitted
  | DecodedJobCompleted
  | DecodedJobRejected
  | DecodedJobExpired;

// ── Decoding helpers ────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Parse comma-separated topics string into an array of hex strings. */
export function parseTopics(topics: string): string[] {
  if (!topics) return [];
  return topics
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.startsWith("0x"));
}

/** Decode a 32-byte hex topic into a bigint. */
function topicToBigInt(topic: string): bigint {
  return BigInt(topic);
}

/** Decode a 32-byte hex topic into an address (last 20 bytes). */
function topicToAddress(topic: string): string {
  return "0x" + topic.slice(26).toLowerCase();
}

/** Decode ABI-encoded string from hex data at the given word offset.
 *  wordOffset is in ABI words (32 bytes = 64 hex chars each).
 *  Reads length at that word, then reads length bytes of string data. */
function decodeAbiString(data: string, wordOffset: number): string {
  if (!data || data === "0x") return "";
  const dataHex = data.startsWith("0x") ? data.slice(2) : data;
  const hexOffset = wordOffset * 64; // each ABI word = 32 bytes = 64 hex chars
  // Read string length at offset position
  const lengthHex = dataHex.slice(hexOffset, hexOffset + 64);
  if (!lengthHex || lengthHex.length < 64) return "";
  const length = parseInt(lengthHex, 16);
  if (length === 0 || isNaN(length)) return "";
  // Read string data (starts 32 bytes after length)
  const dataStart = hexOffset + 64;
  const dataHex2 = dataHex.slice(dataStart, dataStart + length * 2);
  if (!dataHex2) return "";
  // Convert hex to UTF-8
  let result = "";
  for (let i = 0; i < dataHex2.length; i += 2) {
    const code = parseInt(dataHex2.slice(i, i + 2), 16);
    if (code === 0) break;
    result += String.fromCharCode(code);
  }
  return result;
}

// ── Identity event decoder ──────────────────────────────────────────────────

/**
 * Decode a single raw log row into an identity event.
 * Returns null if the log is not a recognized ERC-8004 identity event.
 */
export function decodeIdentityEvent(row: RawLogRow): DecodedIdentityEvent | null {
  try {
    const topics = parseTopics(row.topics);
    if (topics.length === 0) return null;

    const topic0 = topics[0];
    const blockNumber = BigInt(row.block_number);
    const txHash = row.transaction_hash;
    const logIndex = Number(row.log_index);

    if (topic0 === ERC721_TRANSFER_TOPIC && topics.length >= 4) {
      const from = topicToAddress(topics[1]);
      const to = topicToAddress(topics[2]);
      const tokenId = topicToBigInt(topics[3]);
      return {
        kind: "Transfer",
        from,
        to,
        tokenId,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    if (topic0 === ERC8004_NEW_REGISTERED_TOPIC && topics.length >= 2) {
      const tokenId = topicToBigInt(topics[1]);
      return {
        kind: "NewRegistered",
        tokenId,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    if (topic0 === ERC8004_AGENT_REGISTERED_TOPIC && topics.length >= 2) {
      const tokenId = topicToBigInt(topics[1]);
      const data = row.data;
      let controller = ZERO_ADDRESS;
      let metadataURI = "";

      // Decode controller from first 32 bytes of data
      if (data && data !== "0x") {
        const dataHex = data.startsWith("0x") ? data.slice(2) : data;
        if (dataHex.length >= 64) {
          controller = "0x" + dataHex.slice(24, 64).toLowerCase();
        }
        // Decode metadataURI (ABI string starting at word offset 2)
        metadataURI = decodeAbiString(data, 1);
      }

      // Also check if controller is in topic[2] (indexed in some versions)
      if (topics.length >= 3) {
        const topicController = topicToAddress(topics[2]);
        if (topicController !== ZERO_ADDRESS) {
          controller = topicController;
        }
      }

      return {
        kind: "AgentRegistered",
        tokenId,
        controller,
        metadataURI,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    if (topic0 === ERC8004_AGENT_WALLET_TOPIC && topics.length >= 2) {
      const tokenId = topicToBigInt(topics[1]);
      let wallet = ZERO_ADDRESS;
      const data = row.data;
      if (data && data !== "0x") {
        const dataHex = data.startsWith("0x") ? data.slice(2) : data;
        if (dataHex.length >= 64) {
          wallet = "0x" + dataHex.slice(24, 64).toLowerCase();
        }
      }
      if (topics.length >= 3) {
        const topicWallet = topicToAddress(topics[2]);
        if (topicWallet !== ZERO_ADDRESS) {
          wallet = topicWallet;
        }
      }
      return {
        kind: "AgentWallet",
        tokenId,
        wallet,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    return null;
  } catch {
    // Malformed log — skip, never fatal
    return null;
  }
}

// ── Job event decoder ───────────────────────────────────────────────────────

/**
 * Decode a single raw log row into a job event.
 * Returns null if the log is not a recognized ERC-8183 job event.
 */
export function decodeJobEvent(row: RawLogRow): DecodedJobEvent | null {
  try {
    const topics = parseTopics(row.topics);
    if (topics.length === 0) return null;

    const topic0 = topics[0];
    const blockNumber = BigInt(row.block_number);
    const txHash = row.transaction_hash;
    const logIndex = Number(row.log_index);

    if (topic0 === ERC8183_JOB_CREATED_TOPIC && topics.length >= 4) {
      const jobId = topicToBigInt(topics[1]);
      const client = topicToAddress(topics[2]);
      const provider = topicToAddress(topics[3]);
      // data contains: evaluator (address), expiredAt (uint256), hook (address)
      let evaluator = ZERO_ADDRESS;
      let expiredAt = 0n;
      let hook = ZERO_ADDRESS;
      const data = row.data;
      if (data && data !== "0x") {
        const dataHex = data.startsWith("0x") ? data.slice(2) : data;
        if (dataHex.length >= 64) {
          evaluator = "0x" + dataHex.slice(24, 64).toLowerCase();
        }
        if (dataHex.length >= 128) {
          expiredAt = BigInt("0x" + dataHex.slice(64, 128));
        }
        if (dataHex.length >= 192) {
          hook = "0x" + dataHex.slice(152, 192).toLowerCase();
        }
      }
      return {
        kind: "JobCreated",
        jobId,
        client,
        provider,
        evaluator,
        expiredAt,
        hook,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    if (topic0 === ERC8183_BUDGET_SET_TOPIC && topics.length >= 2) {
      const jobId = topicToBigInt(topics[1]);
      let amount = 0n;
      const data = row.data;
      if (data && data !== "0x") {
        const dataHex = data.startsWith("0x") ? data.slice(2) : data;
        if (dataHex.length >= 64) {
          amount = BigInt("0x" + dataHex.slice(0, 64));
        }
      }
      return {
        kind: "BudgetSet",
        jobId,
        amount,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    if (topic0 === ERC8183_JOB_FUNDED_TOPIC && topics.length >= 3) {
      const jobId = topicToBigInt(topics[1]);
      const client = topicToAddress(topics[2]);
      let amount = 0n;
      const data = row.data;
      if (data && data !== "0x") {
        const dataHex = data.startsWith("0x") ? data.slice(2) : data;
        if (dataHex.length >= 64) {
          amount = BigInt("0x" + dataHex.slice(0, 64));
        }
      }
      return {
        kind: "JobFunded",
        jobId,
        client,
        amount,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    if (topic0 === ERC8183_JOB_SUBMITTED_TOPIC && topics.length >= 3) {
      const jobId = topicToBigInt(topics[1]);
      const worker = topicToAddress(topics[2]);
      let deliverable = "";
      const data = row.data;
      if (data && data !== "0x") {
        const dataHex = data.startsWith("0x") ? data.slice(2) : data;
        if (dataHex.length >= 64) {
          deliverable = "0x" + dataHex.slice(0, 64);
        }
      }
      return {
        kind: "JobSubmitted",
        jobId,
        worker,
        deliverable,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    if (topic0 === ERC8183_JOB_COMPLETED_TOPIC && topics.length >= 3) {
      const jobId = topicToBigInt(topics[1]);
      const evaluator = topicToAddress(topics[2]);
      let reason = "";
      const data = row.data;
      if (data && data !== "0x") {
        const dataHex = data.startsWith("0x") ? data.slice(2) : data;
        if (dataHex.length >= 64) {
          reason = "0x" + dataHex.slice(0, 64);
        }
      }
      return {
        kind: "JobCompleted",
        jobId,
        evaluator,
        reason,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    if (topic0 === ERC8183_JOB_REJECTED_TOPIC && topics.length >= 3) {
      const jobId = topicToBigInt(topics[1]);
      const rejector = topicToAddress(topics[2]);
      let reason = "";
      const data = row.data;
      if (data && data !== "0x") {
        const dataHex = data.startsWith("0x") ? data.slice(2) : data;
        if (dataHex.length >= 64) {
          reason = "0x" + dataHex.slice(0, 64);
        }
      }
      return {
        kind: "JobRejected",
        jobId,
        rejector,
        reason,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    if (topic0 === ERC8183_JOB_EXPIRED_TOPIC && topics.length >= 2) {
      const jobId = topicToBigInt(topics[1]);
      return {
        kind: "JobExpired",
        jobId,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    return null;
  } catch {
    // Malformed log — skip, never fatal
    return null;
  }
}

// ── Batch decoders ──────────────────────────────────────────────────────────

/**
 * Decode multiple raw log rows into identity events.
 * Skips unrecognized/malformed logs (never throws).
 */
export function decodeIdentityEvents(rows: RawLogRow[]): DecodedIdentityEvent[] {
  const results: DecodedIdentityEvent[] = [];
  for (const row of rows) {
    const decoded = decodeIdentityEvent(row);
    if (decoded) results.push(decoded);
  }
  return results;
}

/**
 * Decode multiple raw log rows into job events.
 * Skips unrecognized/malformed logs (never throws).
 */
export function decodeJobEvents(rows: RawLogRow[]): DecodedJobEvent[] {
  const results: DecodedJobEvent[] = [];
  for (const row of rows) {
    const decoded = decodeJobEvent(row);
    if (decoded) results.push(decoded);
  }
  return results;
}

/**
 * Filter rows by minimum block number.
 * Returns only rows where block_number >= fromBlock.
 */
export function filterByBlock<T extends { block_number: string | number }>(
  rows: T[],
  fromBlock: number,
): T[] {
  return rows.filter((r) => Number(r.block_number) >= fromBlock);
}
