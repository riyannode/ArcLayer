import {
  ERC8004_IDENTITY_REGISTRY_ABI,
  ERC8183_AGENTIC_COMMERCE_ABI,
  CONTRACTS,
  publicClient,
} from "@arclayer/sdk";
import type { IndexedAgentEvent, IndexedJobEvent } from "@arclayer/sdk";
import { MAX_BLOCK_RANGE, OLD_ARCLAYER_AGENT_REGISTRY_ADDRESS } from "./config";

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

const OLD_ARCLAYER_AGENT_REGISTRY_ABI = [
  {
    type: "event",
    name: "AgentRegistered",
    inputs: [
      { indexed: true, name: "agentId", type: "uint256" },
      { indexed: true, name: "skillHash", type: "bytes32" },
      { indexed: true, name: "controller", type: "address" },
      { indexed: false, name: "metadataURI", type: "string" },
    ],
  },
] as const;

const AGENT_EVENT_ABIS = ERC8004_IDENTITY_REGISTRY_ABI.filter(
  (item): item is typeof item & { type: "event"; name: typeof AGENT_EVENT_NAMES[number] } =>
    item.type === "event" &&
    (AGENT_EVENT_NAMES as readonly string[]).includes((item as { name?: string }).name ?? ""),
);

export type FetchJobEventsResult = {
  events: IndexedJobEvent[];
  latestBlock: bigint;
};

export type FetchAgentEventsResult = {
  events: IndexedAgentEvent[];
  latestBlock: bigint;
};

async function fetchEventsChunked(
  address: `0x${string}`,
  abi: readonly unknown[],
  fromBlock: bigint,
  latestBlock: bigint,
): Promise<any[]> {
  const collected: any[] = [];
  for (let start = fromBlock; start <= latestBlock; start += MAX_BLOCK_RANGE + BigInt(1)) {
    const end = start + MAX_BLOCK_RANGE > latestBlock ? latestBlock : start + MAX_BLOCK_RANGE;
    const chunk = await publicClient.getContractEvents({
      address,
      abi: abi as any,
      fromBlock: start,
      toBlock: end,
    });
    collected.push(...chunk);
  }
  return collected;
}

/**
 * Fetch ERC-8183 AgenticCommerce events from Arc Testnet.
 * Returns normalized IndexedJobEvent[] using official event names.
 */
export async function fetchJobEvents(
  fromBlock: bigint = BigInt(0),
): Promise<FetchJobEventsResult> {
  const latestBlock = await publicClient.getBlockNumber();

  if (fromBlock > latestBlock) {
    return { events: [], latestBlock };
  }

  const collected = await fetchEventsChunked(
    CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    ERC8183_AGENTIC_COMMERCE_ABI,
    fromBlock,
    latestBlock,
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

  return { events, latestBlock };
}

/**
 * Fetch ERC-8004 IdentityRegistry registrations from Arc Testnet.
 * Treats Transfer{from=0x0} as registration event.
 */
export async function fetchAgentEvents(
  fromBlock: bigint = BigInt(0),
): Promise<FetchAgentEventsResult> {
  const latestBlock = await publicClient.getBlockNumber();

  if (fromBlock > latestBlock) {
    return { events: [], latestBlock };
  }

  const collected = await fetchEventsChunked(
    CONTRACTS.ERC8004_IDENTITY_REGISTRY,
    ERC8004_IDENTITY_REGISTRY_ABI,
    fromBlock,
    latestBlock,
  );

  const events = collected
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
    .filter((e) => e.isMint)
    .map(({ event, args }) => ({
      eventName: "AgentRegistered" as const,
      blockNumber: event.blockNumber as bigint,
      transactionHash: event.transactionHash as `0x${string}`,
      logIndex: (event.logIndex ?? 0) as number,
      agentId: args.tokenId as bigint,
      controller: args.to as `0x${string}`,
      metadataURI: "",
      source: "erc8004_identity_registry",
      chainId: 5042002,
      registryAddress: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
      contractAddress: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
    } satisfies IndexedAgentEvent & Record<string, unknown>))
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return Number(a.blockNumber - b.blockNumber);
      }
      return a.logIndex - b.logIndex;
    });

  return { events, latestBlock };
}

export async function fetchImportedArcLayerAgentEvents(
  fromBlock: bigint = BigInt(0),
): Promise<FetchAgentEventsResult> {
  const latestBlock = await publicClient.getBlockNumber();

  if (fromBlock > latestBlock) {
    return { events: [], latestBlock };
  }

  const collected = await fetchEventsChunked(
    OLD_ARCLAYER_AGENT_REGISTRY_ADDRESS,
    OLD_ARCLAYER_AGENT_REGISTRY_ABI,
    fromBlock,
    latestBlock,
  );

  const events = collected
    .filter((event: any) => event.eventName === "AgentRegistered")
    .map((event: any) => {
      const args = (event.args ?? {}) as Record<string, unknown>;
      return {
        eventName: "AgentRegistered" as const,
        blockNumber: event.blockNumber as bigint,
        transactionHash: event.transactionHash as `0x${string}`,
        logIndex: (event.logIndex ?? 0) as number,
        agentId: args.agentId as bigint,
        controller: args.controller as `0x${string}`,
        metadataURI: (args.metadataURI as string | undefined) ?? "",
        skillHash: args.skillHash as `0x${string}` | undefined,
        source: "imported_arclayer_registry",
        chainId: 5042002,
        registryAddress: OLD_ARCLAYER_AGENT_REGISTRY_ADDRESS,
        contractAddress: OLD_ARCLAYER_AGENT_REGISTRY_ADDRESS,
      } satisfies IndexedAgentEvent & Record<string, unknown>;
    })
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber - b.blockNumber);
      return a.logIndex - b.logIndex;
    });

  return { events, latestBlock };
}

// Re-export for backwards compatibility with any external importers.
export { JOB_EVENT_ABIS, AGENT_EVENT_ABIS };
