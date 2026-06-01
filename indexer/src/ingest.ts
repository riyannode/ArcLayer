import {
  ERC8004_IDENTITY_REGISTRY_ABI,
  ERC8004_REPUTATION_REGISTRY_ABI,
  ERC8183_AGENTIC_COMMERCE_ABI,
  CONTRACTS,
  publicClient,
} from "@arclayer/sdk";
import type { IndexedAgentEvent, IndexedJobEvent, IndexedReputationEvent } from "@arclayer/sdk";

// ── Official ERC-8183 AgenticCommerce events ────────────────────────────────

const JOB_EVENT_NAMES = [
  "JobCreated",
  "BudgetSet",
  "JobFunded",
  "JobSubmitted",
  "JobCompleted",
] as const;

const JOB_EVENT_ABIS = ERC8183_AGENTIC_COMMERCE_ABI.filter(
  (item): item is typeof item & { type: "event"; name: typeof JOB_EVENT_NAMES[number] } =>
    item.type === "event" &&
    (JOB_EVENT_NAMES as readonly string[]).includes((item as { name?: string }).name ?? ""),
);

// ── Official ERC-8004 IdentityRegistry events ───────────────────────────────
// ERC-8004 is ERC-721-like — Transfer event signals registration when from=0x0.

const AGENT_EVENT_NAMES = ["Transfer"] as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";


const AGENT_EVENT_ABIS = ERC8004_IDENTITY_REGISTRY_ABI.filter(
  (item): item is typeof item & { type: "event"; name: typeof AGENT_EVENT_NAMES[number] } =>
    item.type === "event" &&
    (AGENT_EVENT_NAMES as readonly string[]).includes((item as { name?: string }).name ?? ""),
);

// ── ERC-8004 Reputation Registry events ─────────────────────────────────────

const REPUTATION_EVENT_NAMES = ["NewFeedback"] as const;

const REPUTATION_EVENT_ABIS = ERC8004_REPUTATION_REGISTRY_ABI.filter(
  (item): item is typeof item & { type: "event"; name: typeof REPUTATION_EVENT_NAMES[number] } =>
    item.type === "event" &&
    (REPUTATION_EVENT_NAMES as readonly string[]).includes((item as { name?: string }).name ?? ""),
);

export type FetchJobEventsResult = {
  events: IndexedJobEvent[];
};

export type FetchAgentEventsResult = {
  events: IndexedAgentEvent[];
};

export async function getLatestBlock() {
  return publicClient.getBlockNumber();
}

const MIN_CHUNK_BLOCKS = 500n;

async function fetchEventsInRangeRaw(
  address: `0x${string}`,
  abi: readonly unknown[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<any[]> {
  return publicClient.getContractEvents({
    address,
    abi: abi as any,
    fromBlock,
    toBlock,
  });
}

/**
 * Fetch events with automatic range-split fallback.
 * If the full range RPC call fails, split in half and retry each chunk.
 * Recurses until chunks reach MIN_CHUNK_BLOCKS.
 */
async function fetchEventsInRange(
  address: `0x${string}`,
  abi: readonly unknown[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<any[]> {
  try {
    return await fetchEventsInRangeRaw(address, abi, fromBlock, toBlock);
  } catch (err) {
    const range = toBlock - fromBlock;
    if (range <= MIN_CHUNK_BLOCKS) {
      // Already at minimum chunk size — propagate the error.
      throw err;
    }

    const mid = fromBlock + range / 2n;
    console.warn(
      `[indexer] getLogs failed for range ${fromBlock}-${toBlock} (${range} blocks), splitting at ${mid}`,
    );

    const [left, right] = await Promise.all([
      fetchEventsInRange(address, abi, fromBlock, mid),
      fetchEventsInRange(address, abi, mid + 1n, toBlock),
    ]);

    return [...left, ...right];
  }
}

/**
 * Fetch ERC-8183 AgenticCommerce events from Arc Testnet.
 * Returns normalized IndexedJobEvent[] using official event names.
 */
export async function fetchJobEvents(
  fromBlock: bigint = BigInt(0),
  toBlock: bigint,
): Promise<FetchJobEventsResult> {
  if (fromBlock > toBlock) {
    return { events: [] };
  }

  const collected = await fetchEventsInRange(
    CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    ERC8183_AGENTIC_COMMERCE_ABI,
    fromBlock,
    toBlock,
  );

  const events = collected
    .filter((event: any) => (JOB_EVENT_NAMES as readonly string[]).includes(event.eventName))
    .map((event: any) => ({
      eventName: event.eventName as IndexedJobEvent["eventName"],
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex ?? 0,
      ...(event.args as Record<string, unknown>),
    }))
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return Number(a.blockNumber - b.blockNumber);
      }
      return a.logIndex - b.logIndex;
    });

  return { events };
}

/**
 * Fetch ERC-8004 IdentityRegistry registrations from Arc Testnet.
 * Treats Transfer{from=0x0} as registration event.
 */
export async function fetchAgentEvents(
  fromBlock: bigint = BigInt(0),
  toBlock: bigint,
): Promise<FetchAgentEventsResult> {
  if (fromBlock > toBlock) {
    return { events: [] };
  }

  const collected = await fetchEventsInRange(
    CONTRACTS.ERC8004_IDENTITY_REGISTRY,
    ERC8004_IDENTITY_REGISTRY_ABI,
    fromBlock,
    toBlock,
  );

  const mintEvents = collected
    .filter((event: any) => event.eventName === "Transfer")
    .map((event: any) => {
      const args = (event.args ?? {}) as Record<string, unknown>;
      const from = (args.from as string | undefined)?.toLowerCase();
      const isMint = from === ZERO_ADDRESS;
      return {
        isMint,
        event,
        args,
      };
    })
    .filter((e) => e.isMint);

  const events = (await Promise.all(mintEvents.map(async ({ event, args }) => {
    const agentId = args.tokenId as bigint;
    let metadataURI = "";
    try {
      metadataURI = await publicClient.readContract({
        address: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
        abi: ERC8004_IDENTITY_REGISTRY_ABI,
        functionName: "tokenURI",
        args: [agentId],
      }) as string;
    } catch {
      metadataURI = "";
    }

    return {
      eventName: "AgentRegistered" as const,
      blockNumber: event.blockNumber as bigint,
      transactionHash: event.transactionHash as `0x${string}`,
      logIndex: (event.logIndex ?? 0) as number,
      agentId,
      controller: args.to as `0x${string}`,
      metadataURI,
      source: "erc8004_identity_registry",
      chainId: 5042002,
      registryAddress: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
      contractAddress: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
    } satisfies IndexedAgentEvent & Record<string, unknown>;
  })))
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return Number(a.blockNumber - b.blockNumber);
      }
      return a.logIndex - b.logIndex;
    });

  return { events };
}

export type FetchReputationEventsResult = {
  events: IndexedReputationEvent[];
};

export async function fetchReputationEvents(
  fromBlock: bigint = BigInt(0),
  toBlock: bigint,
): Promise<FetchReputationEventsResult> {
  if (fromBlock > toBlock) {
    return { events: [] };
  }

  const collected = await fetchEventsInRange(
    CONTRACTS.ERC8004_REPUTATION_REGISTRY,
    ERC8004_REPUTATION_REGISTRY_ABI,
    fromBlock,
    toBlock,
  );

  const events = collected
    .filter((event: any) => event.eventName === "NewFeedback")
    .map((event: any) => {
      const args = (event.args ?? {}) as Record<string, unknown>;

      // Map contract event fields to SDK normalized names.
      // Contract giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)
      // Write route passes: (agentTokenId, score, category, comment, metadataURI, proofURI, context, ref)
      // Event emit: NewFeedback(..., tag1, tag1, tag2, endpoint, feedbackURI, feedbackHash)
      //   tag1 = comment (param 4), tag2 = metadataURI (param 5),
      //   endpoint = proofURI (param 6), feedbackURI = context (param 7),
      //   feedbackHash = ref (param 8)
      return {
        eventName: "NewFeedback" as const,
        blockNumber: event.blockNumber as bigint,
        transactionHash: event.transactionHash as `0x${string}`,
        logIndex: (event.logIndex ?? 0) as number,
        agentTokenId: args.agentId as bigint,
        reviewer: args.clientAddress as `0x${string}`,
        feedbackIndex: Number(args.feedbackIndex ?? 0),
        score: args.value as bigint,
        category: Number(args.valueDecimals ?? 0),
        comment: typeof args.tag1 === "string" ? args.tag1 : "",
        metadataURI: typeof args.tag2 === "string" ? args.tag2 : "",
        proofURI: typeof args.endpoint === "string" ? args.endpoint : "",
        context: typeof args.feedbackURI === "string" ? args.feedbackURI : "",
        ref: args.feedbackHash as `0x${string}` | undefined,
      } satisfies IndexedReputationEvent;
    })
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return Number(a.blockNumber - b.blockNumber);
      }
      return a.logIndex - b.logIndex;
    });

  return { events };
}

// Re-export for backwards compatibility with any external importers.
export { JOB_EVENT_ABIS, AGENT_EVENT_ABIS, REPUTATION_EVENT_ABIS };
