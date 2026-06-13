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
 * Topic hashes verified against actual Arc Testnet on-chain ABI:
 *   IdentityRegistryUpgradeable: Transfer, Registered, MetadataSet
 *   AgenticCommerce: JobCreated, BudgetSet, JobFunded, JobSubmitted,
 *                    JobCompleted, JobRejected, JobExpired
 *
 * SERVER-ONLY — uses no browser APIs, no client imports.
 *
 * @module apps/console/src/lib/goldsky-raw-log-decoder
 */

// ── Event signature hashes (topic[0]) — verified from on-chain ABI ─────────
//
// IdentityRegistryUpgradeable implementation:
//   0x7274e874CA62410a93Bd8bf61c69d8045E399c02
//   Events: Transfer, Registered, MetadataSet, Approval, ApprovalForAll,
//           BatchMetadataUpdate, EIP712DomainChanged, Initialized,
//           MetadataUpdate, OwnershipTransferred, URIUpdated, Upgraded
//
// AgenticCommerce (SDK ABI):
//   Events: JobCreated, BudgetSet, JobFunded, JobSubmitted,
//           JobCompleted, JobRejected, JobExpired

/** ERC-721 Transfer(from, to, tokenId) — used by ERC-8004 Identity Registry. */
const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** ERC-8004 Registered(uint256 indexed agentId, string metadataURI, address indexed owner). */
const ERC8004_REGISTERED_TOPIC =
  "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";

/** ERC-8004 MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string value, bytes data) — metadata update, NOT registration. */
const ERC8004_METADATA_SET_TOPIC =
  "0x2c149ed548c6d2993cd73efe187df6eccabe4538091b33adbd25fafdb8a1468b";

/** ERC-8183 JobCreated(jobId, client, provider, evaluator, expiredAt, hook). */
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

/** ERC-8183 JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason). */
const ERC8183_JOB_REJECTED_TOPIC =
  "0xae7362b1af91f4492868987b9c73990d780060811551b58728fbe96fd1bab275";

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

export type DecodedRegistered = {
  kind: "Registered";
  agentId: bigint;
  metadataURI: string;
  owner: string; // indexed owner/controller address
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
};

export type DecodedIdentityEvent = DecodedTransfer | DecodedRegistered;

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

/**
 * Decode ABI-encoded dynamic string from hex data using UTF-8.
 *
 * ABI encoding for `string`:
 *   - offset (32 bytes): points to start of string data within the full encoding
 *   - length (32 bytes): byte length of the string
 *   - data: UTF-8 bytes, padded to 32-byte boundary
 *
 * @param data - Full ABI-encoded hex data (with 0x prefix)
 * @param paramIndex - Index of the string param in the ABI encoding (0-based)
 */
function decodeAbiString(data: string, paramIndex: number): string {
  if (!data || data === "0x") return "";
  const dataHex = data.startsWith("0x") ? data.slice(2) : data;

  // Read offset at paramIndex * 32 bytes (64 hex chars each)
  const offsetHexPos = paramIndex * 64;
  const offsetHex = dataHex.slice(offsetHexPos, offsetHexPos + 64);
  if (!offsetHex || offsetHex.length < 64) return "";
  const offset = parseInt(offsetHex, 16);
  if (isNaN(offset)) return "";

  // Read string length at offset position (offset is in bytes, multiply by 2 for hex char position)
  const lengthHexPos = offset * 2;
  const lengthHex = dataHex.slice(lengthHexPos, lengthHexPos + 64);
  if (!lengthHex || lengthHex.length < 64) return "";
  const length = parseInt(lengthHex, 16);
  if (length === 0 || isNaN(length)) return "";

  // Read string data (starts 32 bytes after length)
  const dataStart = lengthHexPos + 64;
  const dataHexBytes = dataHex.slice(dataStart, dataStart + length * 2);
  if (!dataHexBytes) return "";

  // Convert hex bytes to UTF-8 using TextDecoder, then strip trailing null bytes
  try {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = parseInt(dataHexBytes.slice(i * 2, i * 2 + 2), 16);
    }
    // Strip trailing null bytes (ABI padding)
    let end = length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    return new TextDecoder("utf-8").decode(bytes.subarray(0, end));
  } catch {
    return "";
  }
}

// ── Identity event decoder ──────────────────────────────────────────────────

/**
 * Decode a single raw log row into an identity event.
 * Returns null if the log is not a recognized ERC-8004 identity event
 * or if it is a non-registration event (e.g. MetadataSet).
 */
export function decodeIdentityEvent(row: RawLogRow): DecodedIdentityEvent | null {
  try {
    const topics = parseTopics(row.topics);
    if (topics.length === 0) return null;

    const topic0 = topics[0];
    const blockNumber = BigInt(row.block_number);
    const txHash = row.transaction_hash;
    const logIndex = Number(row.log_index);

    // Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
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

    // Registered(uint256 indexed agentId, string metadataURI, address indexed owner)
    // This is the canonical registration event — NOT AgentWallet.
    // topics[1] = agentId (indexed), topics[2] = owner (indexed)
    // data = ABI-encoded string metadataURI
    if (topic0 === ERC8004_REGISTERED_TOPIC && topics.length >= 3) {
      const agentId = topicToBigInt(topics[1]);
      const owner = topicToAddress(topics[2]);
      const metadataURI = decodeAbiString(row.data, 0);

      return {
        kind: "Registered",
        agentId,
        metadataURI,
        owner,
        blockNumber,
        transactionHash: txHash,
        logIndex,
      };
    }

    // MetadataSet(uint256 indexed agentId, string indexed key, string value, bytes data)
    // This is a metadata UPDATE — not a registration event.
    // Skip it: agent projection is last-event-wins, and using MetadataSet
    // as registration would fabricate a controller from ABI offset data.
    if (topic0 === ERC8004_METADATA_SET_TOPIC) {
      return null;
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
