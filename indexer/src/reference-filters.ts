import {
  ARC_REFERENCE_AGENT_ID_FILTER as ENV_AGENT_ID_FILTER,
  ARC_REFERENCE_WALLET_FILTER as ENV_WALLET_FILTER,
} from "./config";

type ReferenceFilters = {
  wallets: string[];
  agentIds: string[];
  supabaseWallets: number;
  supabaseAgentIds: number;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
};

const state: ReferenceFilters = {
  wallets: [...ENV_WALLET_FILTER],
  agentIds: ENV_AGENT_ID_FILTER.map((id) => id.toLowerCase()),
  supabaseWallets: 0,
  supabaseAgentIds: 0,
  lastRefreshAt: null,
  lastRefreshError: null,
};

function normalizeWallet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return lower.startsWith("0x") && lower.length === 42 ? lower : null;
}

function normalizeAgentId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  return text ? text : null;
}

function referenceAgentIdCandidates(value: unknown): string[] {
  const id = normalizeAgentId(value);
  if (!id) return [];
  const raw = id.includes(":") ? id.split(":").pop() || id : id;
  return Array.from(new Set([
    raw,
    id,
    `erc8004_identity_registry:${raw}`,
    `imported_arclayer_registry:${raw}`,
  ]));
}

async function fetchSupabaseRows(table: string, select: string): Promise<any[]> {
  const baseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return [];

  const endpoint = `${baseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=10000`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!res.ok) {
    // 404/permission/schema drift should not kill indexing; caller records a compact sanitized error.
    throw new Error(`${table}:${res.status}`);
  }

  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

async function fetchA2AJobRows(): Promise<{ rows: any[]; fallbackError: string | null }> {
  try {
    return { rows: await fetchSupabaseRows("a2a_jobs", "provider,evaluator,claimed_by"), fallbackError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("a2a_jobs:400")) throw error;
    return {
      rows: await fetchSupabaseRows("a2a_jobs", "provider,evaluator"),
      fallbackError: "a2a_jobs claimed_by fallback: a2a_jobs:400",
    };
  }
}

export async function refreshReferenceFiltersFromSupabase(): Promise<ReferenceFilters> {
  const walletSet = new Set(ENV_WALLET_FILTER);
  const agentIdSet = new Set(ENV_AGENT_ID_FILTER.map((id) => id.toLowerCase()));
  let supabaseWallets = 0;
  let supabaseAgentIds = 0;

  try {
    // Agent identities registered through ArcLayer UI/API.
    try {
      for (const row of await fetchSupabaseRows("agent_manifests", "agent_id,controller,signer")) {
        const agentId = normalizeAgentId(row.agent_id);
        if (agentId) {
          agentIdSet.add(agentId);
          supabaseAgentIds++;
        }
        for (const key of ["controller", "signer"]) {
          const wallet = normalizeWallet(row[key]);
          if (wallet) {
            walletSet.add(wallet);
            supabaseWallets++;
          }
        }
      }
    } catch (error) {
      throw error;
    }

    let a2aFallbackError: string | null = null;
    try {
      const result = await fetchA2AJobRows();
      a2aFallbackError = result.fallbackError;
      // ArcLayer-created ERC-8183 jobs mirrored by API-first workers / UI.
      for (const row of result.rows) {
        for (const key of ["provider", "evaluator", "claimed_by"]) {
          const wallet = normalizeWallet(row[key]);
          if (wallet) {
            walletSet.add(wallet);
            supabaseWallets++;
          }
        }
      }
    } catch (error) {
      a2aFallbackError = error instanceof Error ? error.message : String(error);
    }

    state.wallets = [...walletSet];
    state.agentIds = [...agentIdSet];
    state.supabaseWallets = supabaseWallets;
    state.supabaseAgentIds = supabaseAgentIds;
    state.lastRefreshAt = new Date().toISOString();
    state.lastRefreshError = a2aFallbackError;
  } catch (error) {
    state.wallets = [...walletSet];
    state.agentIds = [...agentIdSet];
    state.supabaseWallets = supabaseWallets;
    state.supabaseAgentIds = supabaseAgentIds;
    state.lastRefreshAt = new Date().toISOString();
    state.lastRefreshError = error instanceof Error ? error.message : String(error);
  }

  return getReferenceFilters();
}

export function getReferenceFilters(): ReferenceFilters {
  return {
    wallets: [...state.wallets],
    agentIds: [...state.agentIds],
    supabaseWallets: state.supabaseWallets,
    supabaseAgentIds: state.supabaseAgentIds,
    lastRefreshAt: state.lastRefreshAt,
    lastRefreshError: state.lastRefreshError,
  };
}

export function referenceWalletFilterActive(): boolean {
  return state.wallets.length > 0;
}

export function referenceAgentIdFilterActive(): boolean {
  return state.agentIds.length > 0;
}

export function matchesReferenceWallet(addr: unknown, scope: "arclayer" | "arcnetwork" = "arclayer"): boolean {
  if (scope === "arcnetwork") return true;
  if (!referenceWalletFilterActive()) return true;
  const wallet = normalizeWallet(addr);
  return wallet ? state.wallets.includes(wallet) : false;
}

export function matchesReferenceAgentId(agentId: unknown, scope: "arclayer" | "arcnetwork" = "arclayer"): boolean {
  if (scope === "arcnetwork") return true;
  if (!referenceAgentIdFilterActive()) return true;
  const candidates = referenceAgentIdCandidates(agentId);
  return candidates.some((id) => state.agentIds.includes(id));
}
