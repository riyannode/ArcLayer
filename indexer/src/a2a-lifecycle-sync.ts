import { decodeEventLog, getAddress, type Address, type Log } from "viem";
import { CONTRACTS, ERC8183_AGENTIC_COMMERCE_ABI } from "@arclayer/sdk";

export enum ERC8183JobStatus {
  Open = 0,
  Funded = 1,
  Submitted = 2,
  Completed = 3,
  Rejected = 4,
  Expired = 5,
  Created = Open,
  BudgetSet = Open,
}

type Hex = `0x${string}`;

export type JobCreatedEvent = {
  eventName: "JobCreated";
  jobId: bigint;
  provider: Address;
  evaluator: Address;
  budget?: bigint;
};

export type BudgetSetEvent = {
  eventName: "BudgetSet";
  jobId: bigint;
  amount: bigint;
};

export type JobFundedEvent = {
  eventName: "JobFunded";
  jobId: bigint;
  amount?: bigint;
};

export type JobSubmittedEvent = {
  eventName: "JobSubmitted";
  jobId: bigint;
  deliverable: Hex;
};

export type JobCompletedEvent = {
  eventName: "JobCompleted";
  jobId: bigint;
};

export type ERC8183JobLifecycleEvent =
  | JobCreatedEvent
  | BudgetSetEvent
  | JobFundedEvent
  | JobSubmittedEvent
  | JobCompletedEvent;

export type ERC8183IndexedLifecycleEvent = ERC8183JobLifecycleEvent & {
  transactionHash?: Hex;
  blockTimestamp?: bigint | number | string | Date | null;
};

type LogLike = Pick<Log, "address" | "data" | "topics"> & {
  transactionHash?: Hex;
  blockTimestamp?: bigint | number | string | Date | null;
};

export type ERC8004AgentProjection = {
  agentId: string;
  tokenId: string;
  owner: string;
  controller: string;
  metadataURI: string;
  source: string;
  chainId: string;
  registryAddress: string;
  txHash: string;
  blockNumber: string;
  mintedAt?: string;
  metadataJSON?: Record<string, unknown> | null;
};

type SupabaseJobTable = {
  update(payload: Record<string, unknown>): {
    eq(column: "onchain_job_id", value: string): Promise<{ error?: { message?: string } | null }>;
  };
};

type SupabaseAgentTable = {
  upsert(payload: Record<string, unknown>, onConflict: string): Promise<{ error?: { message?: string } | null }>;
};

type SupabaseLike = {
  from(table: "a2a_jobs"): SupabaseJobTable;
  from(table: "erc8004_agents"): SupabaseAgentTable;
  from(table: string): SupabaseJobTable | SupabaseAgentTable;
};

export const ERC8183_AGENTIC_COMMERCE_ADDRESS = CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address;

function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a as Address) === getAddress(b as Address);
  } catch {
    return false;
  }
}

function isoFromBlockTimestamp(value: ERC8183IndexedLifecycleEvent["blockTimestamp"]): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  if (typeof value === "bigint") return new Date(Number(value) * 1000).toISOString();
  if (typeof value === "string" && value.trim()) {
    if (/^\d+$/.test(value)) return isoFromBlockTimestamp(BigInt(value));
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function decodeLifecycleEvent(log: Pick<Log, "data" | "topics">): ERC8183JobLifecycleEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: ERC8183_AGENTIC_COMMERCE_ABI,
      data: log.data,
      topics: log.topics,
    });

    if (!["JobCreated", "BudgetSet", "JobFunded", "JobSubmitted", "JobCompleted"].includes(decoded.eventName)) {
      return null;
    }

    return {
      eventName: decoded.eventName,
      ...(decoded.args as Record<string, unknown>),
    } as ERC8183JobLifecycleEvent;
  } catch {
    return null;
  }
}

export function parseERC8183JobLifecycleEvent(log: Pick<Log, "data" | "topics">): ERC8183JobLifecycleEvent | null {
  return decodeLifecycleEvent(log);
}

export function lifecycleUpdatePayload(event: ERC8183IndexedLifecycleEvent): Record<string, unknown> | null {
  switch (event.eventName) {
    case "JobCreated": {
      const payload: Record<string, unknown> = {
        is_onchain: true,
        onchain_job_id: event.jobId.toString(),
        provider: getAddress(event.provider),
        evaluator: getAddress(event.evaluator),
        settlement_status: ERC8183JobStatus.Open,
      };
      if (event.budget !== undefined) payload.budget_atomic = event.budget.toString();
      return payload;
    }
    case "BudgetSet":
      return {
        budget_atomic: event.amount.toString(),
        settlement_status: ERC8183JobStatus.Open,
      };
    case "JobFunded":
      return {
        ...(event.transactionHash ? { fund_tx: event.transactionHash } : {}),
        settlement_status: ERC8183JobStatus.Funded,
      };
    case "JobSubmitted":
      return {
        ...(event.transactionHash ? { submit_tx: event.transactionHash } : {}),
        deliverable_hash: event.deliverable,
        settlement_status: ERC8183JobStatus.Submitted,
        status: "submitted",
        submitted_at: isoFromBlockTimestamp(event.blockTimestamp),
      };
    case "JobCompleted":
      return {
        ...(event.transactionHash ? { complete_tx: event.transactionHash } : {}),
        settlement_status: ERC8183JobStatus.Completed,
      };
    default:
      return null;
  }
}

export async function syncA2AJobsFromERC8183Events(
  events: ERC8183IndexedLifecycleEvent[],
  supabase: SupabaseLike,
): Promise<{ updated: number; skipped: number }> {
  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    const payload = lifecycleUpdatePayload(event);
    if (!payload) {
      skipped++;
      continue;
    }

    const { error } = await supabase.from("a2a_jobs").update(payload).eq("onchain_job_id", event.jobId.toString());
    if (error) throw new Error(`[indexer] a2a_jobs lifecycle update failed: ${error.message ?? "unknown error"}`);
    updated++;
  }

  return { updated, skipped };
}

export async function syncA2AJobsFromERC8183Logs(
  logs: LogLike[],
  supabase: SupabaseLike,
): Promise<{ updated: number; skipped: number }> {
  const events: ERC8183IndexedLifecycleEvent[] = [];

  for (const log of logs) {
    if (!sameAddress(log.address, ERC8183_AGENTIC_COMMERCE_ADDRESS)) continue;
    const parsed = parseERC8183JobLifecycleEvent(log);
    if (!parsed) continue;
    events.push({
      ...parsed,
      transactionHash: log.transactionHash,
      blockTimestamp: log.blockTimestamp,
    });
  }

  return syncA2AJobsFromERC8183Events(events, supabase);
}

export async function syncERC8004AgentsToSupabase(
  agents: ERC8004AgentProjection[],
  supabase: SupabaseLike,
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0;
  let skipped = 0;

  for (const agent of agents) {
    if (!agent.tokenId || !agent.controller) {
      skipped++;
      continue;
    }

    const payload = {
      token_id: agent.tokenId,
      agent_id: agent.agentId,
      owner: agent.owner || agent.controller,
      controller: agent.controller,
      metadata_uri: agent.metadataURI || "",
      metadata_json: agent.metadataJSON ?? null,
      source: agent.source || "erc8004_identity_registry",
      chain_id: agent.chainId,
      registry_address: agent.registryAddress,
      tx_hash: agent.txHash,
      block_number: agent.blockNumber,
      minted_at: agent.mintedAt ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("erc8004_agents")
      .upsert(payload, "token_id");

    if (error) {
      throw new Error(`[indexer] erc8004_agents upsert failed: ${error.message ?? "unknown error"}`);
    }

    upserted++;
  }

  return { upserted, skipped };
}

export function createSupabaseRestClientFromEnv(): SupabaseLike | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const client = {
    from(table: string) {
      if (table === "erc8004_agents") {
        return {
          async upsert(payload: Record<string, unknown>, onConflict: string) {
            const endpoint = `${url.replace(/\/$/, "")}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
            const res = await fetch(endpoint, {
              method: "POST",
              headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
                Prefer: "resolution=merge-duplicates,return=minimal",
              },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
              return { error: { message: await res.text() } };
            }
            return { error: null };
          },
        };
      }

      return {
        update(payload: Record<string, unknown>) {
          return {
            async eq(column: "onchain_job_id", value: string) {
              const endpoint = `${url.replace(/\/$/, "")}/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}`;
              const res = await fetch(endpoint, {
                method: "PATCH",
                headers: {
                  apikey: key,
                  Authorization: `Bearer ${key}`,
                  "Content-Type": "application/json",
                  Prefer: "return=minimal",
                },
                body: JSON.stringify(payload),
              });
              if (!res.ok) {
                return { error: { message: await res.text() } };
              }
              return { error: null };
            },
          };
        },
      };
    },
  };

  return client as SupabaseLike;
}
