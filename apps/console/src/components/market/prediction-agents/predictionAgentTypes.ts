export type AgentRole =
  | "EXECUTOR"
  | "EVALUATOR"
  | "ANALYZER"
  | "ORACLE"
  | "MARKET-AGENT";

export type AgentCategory = "paid" | "x402";
export type AgentStatus = "synced" | "unsynced" | "active";

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Outcome {
  label: string;
  probability: number;
  tokenId: string;
}

export interface BookEntry {
  price: number;
  size: number;
}

export interface SingleBook {
  bids: BookEntry[];
  asks: BookEntry[];
  bestBid: number;
  bestAsk: number | string;
  spread: number | string;
  bidDepth: number;
  askDepth: number;
}

export interface Orderbook {
  up: SingleBook;
  down: SingleBook;
}

export interface MarketPayload {
  asset: string;
  marketSlug: string;
  targetPrice: number;
  livePrice: number;
  distanceFromTarget: number;
  directionNow: string;
  outcomes: {
    up: Outcome;
    down: Outcome;
  };
  orderbook: Orderbook;
  candles1m: Candle[];
}

export interface AgentNode {
  id: string;
  name: string;
  role: AgentRole;
  category: AgentCategory;
  endpoint: string;
  caps: string;
  event: string;
  seen: string;
  status: AgentStatus;
}

export type BackendAgentLike = {
  id?: string;
  agentId?: string;
  address?: string;
  wallet?: string;
  name?: string | null;
  displayName?: string;
  title?: string;
  role?: string | AgentRole | null;
  type?: string;
  kind?: string;
  category?: string | AgentCategory | null;
  categories?: string[];
  paymentMode?: string;
  paymentType?: string;
  scheme?: string;
  endpoint?: string | null;
  url?: string;
  serviceUrl?: string;
  callbackUrl?: string;
  caps?: string | string[] | null;
  capabilities?: string[] | string;
  capability?: string;
  event?: string | null;
  lastEvent?: string | null;
  summary?: string | null;
  seen?: string | number | Date | null;
  lastSeen?: string | number | Date;
  lastSeenAt?: string | number | Date;
  updatedAt?: string | number | Date;
  createdAt?: string | number | Date;
  status?: string | AgentStatus | null;
  syncStatus?: string;
  isSynced?: boolean;
};

const ROLE_ALIASES: Record<string, AgentRole> = {
  executor: "EXECUTOR",
  execute: "EXECUTOR",
  settlement: "EXECUTOR",
  evaluator: "EVALUATOR",
  evaluation: "EVALUATOR",
  analyzer: "ANALYZER",
  analyst: "ANALYZER",
  analysis: "ANALYZER",
  oracle: "ORACLE",
  data: "ORACLE",
  "market-agent": "MARKET-AGENT",
  market_agent: "MARKET-AGENT",
  market: "MARKET-AGENT",
  agent: "MARKET-AGENT",
};

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function normalizeRole(value: unknown, fallback: AgentRole): AgentRole {
  const raw = asString(value).toLowerCase();
  if (!raw) return fallback;

  if (raw === "market-agent" || raw === "market_agent") return "MARKET-AGENT";

  const direct = raw.toUpperCase();
  if (
    direct === "EXECUTOR" ||
    direct === "EVALUATOR" ||
    direct === "ANALYZER" ||
    direct === "ORACLE" ||
    direct === "MARKET-AGENT"
  ) {
    return direct as AgentRole;
  }

  return ROLE_ALIASES[raw] ?? fallback;
}

function normalizeCategory(value: unknown): AgentCategory {
  const raw = asString(value).toLowerCase();

  if (raw.includes("x402")) return "x402";
  if (raw.includes("paid") || raw.includes("usdc") || raw.includes("payment")) return "paid";

  return "x402";
}

function normalizeStatus(value: unknown, isSynced?: unknown): AgentStatus {
  if (typeof isSynced === "boolean") return isSynced ? "synced" : "unsynced";

  const raw = asString(value).toLowerCase();

  if (raw === "active") return "active";
  if (raw === "synced" || raw === "sync" || raw === "online" || raw === "ready") return "synced";
  if (raw === "unsynced" || raw === "offline" || raw === "error" || raw === "stale") return "unsynced";

  return "synced";
}

function normalizeCaps(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean).join(", ");
  }

  return asString(value, "prediction-market workflow");
}

function normalizeSeen(value: unknown): string {
  if (!value) return "live";

  if (value instanceof Date) return value.toISOString();

  if (typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return asString(value, "live");
}

export function normalizeAgent(raw: BackendAgentLike, index = 0): AgentNode {
  const fallbackRoleOrder: AgentRole[] = [
    "ORACLE",
    "ANALYZER",
    "EVALUATOR",
    "MARKET-AGENT",
    "EXECUTOR",
  ];

  const role = normalizeRole(raw.role ?? raw.type ?? raw.kind, fallbackRoleOrder[index % fallbackRoleOrder.length]);

  const endpoint = asString(
    raw.endpoint ?? raw.url ?? raw.serviceUrl ?? raw.callbackUrl,
    "/api/live-a2a-agent/prediction-market-bots",
  );

  const id = asString(
    raw.id ?? raw.agentId ?? raw.address ?? raw.wallet ?? `${role.toLowerCase()}-${index}`,
    `${role.toLowerCase()}-${index}`,
  );

  return {
    id,
    name: asString(
      raw.name ?? raw.displayName ?? raw.title,
      `ArcLayer ${role.replace("-", " ")}`,
    ),
    role,
    category: normalizeCategory(raw.category ?? raw.paymentMode ?? raw.paymentType ?? raw.scheme),
    endpoint,
    caps: normalizeCaps(raw.caps ?? raw.capabilities ?? raw.capability),
    event: asString(raw.event ?? raw.lastEvent ?? raw.summary, "prediction-market-bots"),
    seen: normalizeSeen(raw.seen ?? raw.lastSeen ?? raw.lastSeenAt ?? raw.updatedAt ?? raw.createdAt),
    status: normalizeStatus(raw.status ?? raw.syncStatus, raw.isSynced),
  };
}

export function normalizeAgents(agents: BackendAgentLike[] = []): AgentNode[] {
  return agents.map((agent, index) => normalizeAgent(agent, index));
}
