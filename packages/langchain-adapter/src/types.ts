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
 * "read-only" is SDK-only — NOT a Runner role.
 * The Runner only knows: provider, client, evaluator, x402-agent.
 */
export type ArcLayerAgentRole =
  | "read-only"
  | "x402-agent"
  | "provider"
  | "evaluator"
  | "client";

// ── Provider Pricing Policy ─────────────────────────────────────────────────

/**
 * Provider complexity-based pricing policy.
 * All amounts are USDC decimal strings.
 */
export type ProviderPricingPolicy = {
  minBudgetUsdc?: string;
  maxBudgetUsdc?: string;
  lowComplexityBudgetUsdc?: string;
  mediumComplexityBudgetUsdc?: string;
  highComplexityBudgetUsdc?: string;
  defaultBudgetUsdc?: string;
};

/** Default provider pricing policy. */
export const DEFAULT_PROVIDER_PRICING_POLICY: Required<ProviderPricingPolicy> = {
  minBudgetUsdc: "1.00",
  maxBudgetUsdc: "5.00",
  lowComplexityBudgetUsdc: "1.00",
  mediumComplexityBudgetUsdc: "3.00",
  highComplexityBudgetUsdc: "5.00",
  defaultBudgetUsdc: "1.00",
};

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
  /** Explicit opt-in for arclayer_provider_run_and_submit (provider role only). Default: false. */
  enableProviderRunAndSubmit?: boolean;
  /** Explicit opt-in for arclayer_provider_set_budget (provider role only). Default: false. */
  enableProviderSetBudget?: boolean;
  /** Provider complexity-based pricing policy. Uses defaults if not set. */
  providerPricingPolicy?: ProviderPricingPolicy;
  timeoutMs?: number;
  logger?: ArcLayerLogger;
  /** Custom fetch implementation (for testing or proxy) */
  fetchImpl?: typeof fetch;
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
  /** If true, this tool is handled entirely by the adapter (no Runner HTTP call). */
  adapterOnly?: boolean;
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

// ── Provider Runtime Schemas (input shapes for ERC-8183 tools) ──────────────

/**
 * Input for arclayer_provider_run_only.
 * Matches Runner HTTP body shape (Erc8183ProviderJobSchema superset).
 * Runner parses body as Erc8183ProviderJobSchema which includes
 * evaluator? and metadata? beyond the MCP input schema.
 */
export type ProviderRunOnlyInput = {
  taskId: string;
  jobId: string;
  agentId: string;
  provider: string;
  evaluator?: string;
  description: string;
  input: unknown;
  metadata?: Record<string, unknown>;
};

/**
 * Input for arclayer_provider_run_and_submit.
 * Same shape as ProviderRunOnlyInput — the Runner handles the submit step.
 */
export type ProviderRunAndSubmitInput = ProviderRunOnlyInput;

/**
 * Output from /erc8183/provider/run-only on success.
 */
export type ProviderRunOnlyOutput = {
  ok: true;
  status: string;
  role: string;
  result: unknown;
  deliverableHash: string;
  runId: string;
  receipt: unknown;
};

/**
 * Output from /erc8183/provider/run-and-submit on success.
 * Adds submitReceipt from the on-chain submit step.
 */
export type ProviderRunAndSubmitOutput = ProviderRunOnlyOutput & {
  submitReceipt: unknown;
};

// ── Provider Pricing Schemas ────────────────────────────────────────────────

/**
 * Input for arclayer_provider_quote_job (adapter-only).
 * Estimates complexity and suggests a budget without making any on-chain calls.
 */
export type ProviderQuoteJobInput = {
  jobId: string;
  description: string;
  input: unknown;
  complexityHint?: "low" | "medium" | "high";
  reason?: string;
};

/**
 * Output from arclayer_provider_quote_job.
 */
export type ProviderQuoteJobOutput = {
  ok: true;
  jobId: string;
  complexity: "low" | "medium" | "high";
  suggestedBudgetUsdc: string;
  maxBudgetUsdc: string;
  reason: string;
};

/**
 * Input for arclayer_provider_set_budget.
 * Sends a setBudget transaction through Runner with reason encoded into optParams.
 */
export type ProviderSetBudgetInput = {
  jobId: string;
  amount: string;
  complexity: "low" | "medium" | "high";
  reason: string;
};

/**
 * Output from arclayer_provider_set_budget.
 */
export type ProviderSetBudgetOutput = {
  ok: boolean;
  jobId: string;
  amount: string;
  complexity: "low" | "medium" | "high";
  reason: string;
  status: string;
  txHash?: string;
  receipt: unknown;
  raw: unknown;
};

// ── Runner Response Wrappers ────────────────────────────────────────────────

export type RunnerToolResult = {
  ok: boolean;
  [key: string]: unknown;
};
