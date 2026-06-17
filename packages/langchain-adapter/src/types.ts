/**
 * @arclayer/langchain-adapter — Public type definitions.
 */

// ── Client Options ──────────────────────────────────────────────────────────

export type ArcLayerRunnerClientOptions = {
  /** Runner HTTP base URL (e.g. http://127.0.0.1:8787) */
  runnerUrl: string;
  /** Runner HMAC secret — never logged, never sent to model */
  runnerSecret: string;
  /** Custom fetch implementation (default: globalThis.fetch) */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** User-Agent header value */
  userAgent?: string;
};

// ── Roles ───────────────────────────────────────────────────────────────────

/**
 * SDK-side role presets.
 * "read-only" and "full-stack-agent" are SDK-only — NOT Runner roles.
 * The Runner only knows: provider, client, evaluator, x402-agent.
 */
export type ArcLayerAgentRole =
  | "read-only"
  | "x402-agent"
  | "provider"
  | "evaluator"
  | "client"
  | "full-stack-agent";

// ── Tool Creation Options ───────────────────────────────────────────────────

export type CreateArcLayerLangChainToolsOptions = {
  runnerUrl: string;
  runnerSecret: string;
  role?: ArcLayerAgentRole;
  allowedTools?: string[];
  deniedTools?: string[];
  maxAmountUsdc?: string;
  allowedHosts?: string[];
  deniedHosts?: string[];
  requireIdempotencyKey?: boolean;
  timeoutMs?: number;
  logger?: ArcLayerLogger;
};

// ── Agent Creation Options ──────────────────────────────────────────────────

export type CreateArcLayerLangChainAgentOptions =
  CreateArcLayerLangChainToolsOptions & {
    /** LangChain model instance or model string (e.g. "openai:gpt-4o") */
    model: unknown;
    /** Override the default system prompt */
    systemPrompt?: string;
  };

// ── Logger ──────────────────────────────────────────────────────────────────

export type ArcLayerLogger = {
  debug?: (msg: string, meta?: unknown) => void;
  info?: (msg: string, meta?: unknown) => void;
  warn?: (msg: string, meta?: unknown) => void;
  error?: (msg: string, meta?: unknown) => void;
};

// ── Tool Map Entry ──────────────────────────────────────────────────────────

export type ToolMapEntry = {
  runnerPath: string;
  method: "GET" | "POST";
  mcpName: string;
  risk: "read" | "payment" | "write";
};

// ── x402 Schemas (input shapes for tools) ───────────────────────────────────

export type X402InspectInput = {
  url: string;
  method?: string;
  body?: unknown;
};

export type X402PayInput = {
  url: string;
  method?: string;
  maxAmountUsdc: string;
  reason: string;
  idempotencyKey?: string;
  body?: unknown;
};

export type X402BatchPayPayment = {
  url: string;
  method?: string;
  maxAmountUsdc: string;
  reason: string;
  idempotencyKey?: string;
  body?: unknown;
};

export type X402BatchPayInput = {
  batchId: string;
  taskId: string;
  payments: X402BatchPayPayment[];
};

// ── Runner Response Wrappers ────────────────────────────────────────────────

export type RunnerToolResult = {
  ok: boolean;
  [key: string]: unknown;
};
