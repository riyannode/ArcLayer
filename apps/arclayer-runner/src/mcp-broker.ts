/**
 * MCP Tool Broker — policy enforcement layer between MCP server and tool handler.
 *
 * Responsibilities:
 * 1. Schema validation per tool (input)
 * 2. Tool allowlist / manifest pinning
 * 3. Timeout per tool
 * 4. Budget / max cost / max calls per session
 * 5. Output size cap
 * 6. Audit logging for ALL MCP tool calls
 * 7. Deny privileged tools by default (already handled by role gate, broker adds defense-in-depth)
 * 8. Stable error codes
 */

import { RUNNER_MCP_TOOLS, type McpToolDef } from "./mcp-schemas";
import { getToolByName } from "./tool-registry";

// ── Stable Error Codes ────────────────────────────────────────────────────

export const BrokerErrorCode = {
  TOOL_NOT_FOUND: "BROKER_TOOL_NOT_FOUND",
  SCHEMA_VALIDATION_FAILED: "BROKER_SCHEMA_VALIDATION_FAILED",
  TOOL_NOT_ALLOWED: "BROKER_TOOL_NOT_ALLOWED",
  TOOL_TIMEOUT: "BROKER_TOOL_TIMEOUT",
  BUDGET_EXCEEDED: "BROKER_BUDGET_EXCEEDED",
  MAX_CALLS_EXCEEDED: "BROKER_MAX_CALLS_EXCEEDED",
  OUTPUT_TOO_LARGE: "BROKER_OUTPUT_TOO_LARGE",
  PRIVILEGED_TOOL_DENIED: "BROKER_PRIVILEGED_TOOL_DENIED",
  INTERNAL_ERROR: "BROKER_INTERNAL_ERROR",
} as const;

export type BrokerErrorCode = (typeof BrokerErrorCode)[keyof typeof BrokerErrorCode];

export class BrokerError extends Error {
  constructor(
    readonly code: BrokerErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BrokerError";
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

export type ToolBudgetConfig = {
  /** Max USDC (decimal string) this session can spend across all tool calls */
  maxTotalUsdc?: string;
  /** Max number of tool calls in this session */
  maxCalls?: number;
  /** Per-tool timeout in milliseconds (default: 30_000) */
  defaultTimeoutMs?: number;
  /** Per-tool overrides: { "x402.pay": 60_000 } */
  timeoutOverridesMs?: Record<string, number>;
  /** Max output size in bytes (default: 1MB) */
  maxOutputBytes?: number;
  /** Per-tool output size overrides */
  outputSizeOverridesBytes?: Record<string, number>;
};

/** Redacted args for audit — strips sensitive fields. */
type RedactedArgs = Record<string, unknown>;

export type AuditEntry = {
  timestamp: string;
  toolName: string;
  args: RedactedArgs;
  ok: boolean;
  durationMs: number;
  outputBytes: number;
  errorCode?: BrokerErrorCode;
  errorMessage?: string;
  /** USDC cost if this was a payment tool */
  costUsdc?: string;
  /**
   * true when the broker timed out but the underlying operation may still
   * complete (non-idempotent on-chain writes, Circle CLI subprocesses).
   * Distinguishes "client timed out, operation may have completed" from
   * "operation actually failed".
   */
  timedOut?: boolean;
};

export type BrokerSessionState = {
  callCount: number;
  pendingCalls: number;
  totalCostMicros: bigint;
  auditLog: AuditEntry[];
};

// ── Non-idempotent write tools ──────────────────────────────────────────
// These tools perform on-chain writes that cannot be safely retried.
// They get a higher default timeout (120s vs 30s) because Circle CLI
// subprocess and on-chain confirmation can be slow.

const NON_IDEMPOTENT_WRITE_TOOLS = new Set([
  // x402 payments (idempotency-keyed, but timeout still leaves ambiguous state)
  "x402.pay",
  "x402.batch_pay",
  // ERC-8183 lifecycle writes (on-chain, non-idempotent)
  "erc8183.provider_submit_deliverable",
  "erc8183.provider_run_and_submit",
  "erc8183.create_job",
  "erc8183.set_budget",
  "erc8183.approve_usdc",
  "erc8183.fund_job",
  "erc8183.complete_job",
  "erc8183.reject_job",
  "erc8183.claim_refund",
  "erc8183.set_provider",
  // ERC-8004 identity write
  "erc8004.register_via_circle_cli",
  // Circle gateway deposit
  "circle.gateway_deposit",
]);

/** Default timeout for non-idempotent write tools (120 seconds). */
const WRITE_TOOL_TIMEOUT_MS = 120_000;

/**
 * Check if a tool is a non-idempotent write that may have side effects
 * even after the broker reports a timeout.
 */
export function isNonIdempotentWrite(toolName: string): boolean {
  return NON_IDEMPOTENT_WRITE_TOOLS.has(toolName);
}

// ── Args Redaction ────────────────────────────────────────────────────────

/** Fields that should never appear in audit logs (all lowercase for case-insensitive match). */
const SENSITIVE_FIELDS = new Set([
  "idempotencykey",
  "idempotency_key",
  "token",
  "bearer",
  "authorization",
  "secret",
  "password",
  "privatekey",
  "private_key",
]);

/**
 * Redact sensitive fields from tool args before storing in audit log.
 * Preserves non-sensitive fields for forensic value (url, method, amount, etc).
 */
function redactArgs(args: Record<string, unknown>): RedactedArgs {
  const redacted: RedactedArgs = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      redacted[key] = "[REDACTED]";
    } else if (key === "body") {
      // body can contain arbitrary secrets — redact entirely
      redacted[key] = "[REDACTED]";
    } else if (key === "url" && typeof value === "string" && value.includes("@")) {
      // URLs with embedded credentials
      try {
        const u = new URL(value);
        if (u.username || u.password) {
          u.username = "***";
          u.password = "";
        }
        redacted[key] = u.toString();
      } catch {
        redacted[key] = "[REDACTED_URL]";
      }
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// ── Schema Validation ─────────────────────────────────────────────────────

/**
 * Validate tool arguments against the tool's inputSchema from mcp-schemas.
 * Returns null if valid, BrokerError if invalid.
 *
 * This is a pragmatic validator — checks required fields and type hints.
 * Not a full JSON Schema validator (would add dependency); covers the 90% case.
 *
 * The "object" type accepts any JSON value (object, array, primitive) since
 * fields like `body` in x402 tools accept arbitrary JSON payloads.
 */
function validateToolArgs(
  toolDef: McpToolDef,
  args: Record<string, unknown>
): BrokerError | null {
  const schema = toolDef.inputSchema;
  if (!schema) return null; // No schema = no validation

  for (const [field, spec] of Object.entries(schema)) {
    const fieldSpec = spec as { type?: string; required?: boolean; description?: string };
    const value = args[field];

    // Required check
    if (fieldSpec.required && (value === undefined || value === null || value === "")) {
      return new BrokerError(
        BrokerErrorCode.SCHEMA_VALIDATION_FAILED,
        `Missing required field '${field}' for tool '${toolDef.name}'`,
        { field, tool: toolDef.name }
      );
    }

    // Type check (only if value is present)
    if (value !== undefined && value !== null && fieldSpec.type) {
      const actualType = typeof value;
      const expectedType = fieldSpec.type;

      // Flexible type mapping
      // "object" accepts any JSON value (objects, arrays, primitives)
      // because fields like `body` in x402 tools accept arbitrary payloads.
      const typeOk =
        (expectedType === "string" && actualType === "string") ||
        (expectedType === "number" && actualType === "number") ||
        (expectedType === "boolean" && actualType === "boolean") ||
        // "object" = any JSON value (objects, arrays, string, number, boolean, null)
        (expectedType === "object") ||
        (expectedType === "array" && Array.isArray(value));

      if (!typeOk) {
        return new BrokerError(
          BrokerErrorCode.SCHEMA_VALIDATION_FAILED,
          `Field '${field}' expected ${expectedType}, got ${actualType} for tool '${toolDef.name}'`,
          { field, expected: expectedType, actual: actualType, tool: toolDef.name }
        );
      }
    }
  }

  return null;
}

// ── Output Size Check ─────────────────────────────────────────────────────

function measureOutputSize(result: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(result), "utf-8");
  } catch {
    return 0;
  }
}

// ── Cost Extraction ───────────────────────────────────────────────────────

/**
 * Extract USDC cost from tool arguments (not result).
 *
 * The actual payX402/batchPayX402 results don't contain `amount` — they return
 * `{ ok, result: CircleCliResult, receipt, idempotencyKey }`. The cost is known
 * from the request args (`maxAmountUsdc`), which represent the committed spend.
 *
 * This approach is correct because:
 * - x402.pay args.maxAmountUsdc = the amount that was/will be paid
 * - x402.batch_pay args.payments[].maxAmountUsdc = each item's amount
 * - The policy already validated these amounts before execution
 */
function extractCostMicrosFromArgs(toolName: string, args: Record<string, unknown>): bigint {
  if (toolName === "x402.pay") {
    const maxAmount = args.maxAmountUsdc;
    if (typeof maxAmount === "string" && maxAmount) {
      return decimalToMicros(maxAmount);
    }
  }

  if (toolName === "x402.batch_pay") {
    const payments = args.payments;
    if (Array.isArray(payments)) {
      let total = 0n;
      for (const item of payments) {
        const itemRecord = item as Record<string, unknown>;
        if (typeof itemRecord.maxAmountUsdc === "string") {
          total += decimalToMicros(itemRecord.maxAmountUsdc);
        }
      }
      return total;
    }
  }

  return 0n;
}

function decimalToMicros(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole || "0") * 1_000_000n + BigInt(fracPadded || "0");
}

// ── Tool Broker ───────────────────────────────────────────────────────────

export class McpToolBroker {
  private readonly budget: ToolBudgetConfig;
  private readonly state: BrokerSessionState;
  private readonly maxOutputBytes: number;

  constructor(budget: ToolBudgetConfig = {}) {
    this.budget = budget;
    this.maxOutputBytes = budget.maxOutputBytes ?? 1_048_576; // 1MB default
    this.state = {
      callCount: 0,
      pendingCalls: 0,
      totalCostMicros: 0n,
      auditLog: [],
    };
  }

  /**
   * Get the current session state (for introspection tools).
   */
  getState(): Readonly<BrokerSessionState> {
    return this.state;
  }

  /**
   * Get the audit log.
   */
  getAuditLog(): readonly AuditEntry[] {
    return this.state.auditLog;
  }

  /**
   * Check if a tool is allowed by the broker.
   * Defense-in-depth: the role gate in mcp-server.ts is the primary check,
   * this adds manifest pinning (tool must exist in schemas).
   */
  assertToolAllowed(toolName: string): void {
    // Must exist in tool schemas (manifest pinning)
    const toolDef = RUNNER_MCP_TOOLS.find((t) => t.name === toolName);
    if (!toolDef) {
      // Check if it's a known registry tool (console proxy tools pass through)
      const registryItem = getToolByName(toolName);
      if (registryItem && registryItem.source === "console-mcp-proxy") {
        // Console proxy tools pass through — they have their own validation
        return;
      }
      throw new BrokerError(
        BrokerErrorCode.TOOL_NOT_FOUND,
        `Tool '${toolName}' not found in manifest`,
        { tool: toolName }
      );
    }
  }

  /**
   * Validate tool arguments against its schema.
   */
  validateArgs(toolName: string, args: Record<string, unknown>): void {
    const toolDef = RUNNER_MCP_TOOLS.find((t) => t.name === toolName);
    if (!toolDef) return; // Proxy tools skip schema validation

    const error = validateToolArgs(toolDef, args);
    if (error) throw error;
  }

  /**
   * Check budget constraints before executing a tool call.
   * Includes pending calls in the count to prevent concurrent oversubscription.
   */
  assertBudgetAllowed(): void {
    // Max calls check — include pending calls to prevent concurrent oversubscription
    const effectiveCount = this.state.callCount + this.state.pendingCalls;
    if (this.budget.maxCalls !== undefined && effectiveCount >= this.budget.maxCalls) {
      throw new BrokerError(
        BrokerErrorCode.MAX_CALLS_EXCEEDED,
        `Tool call limit exceeded: ${effectiveCount}/${this.budget.maxCalls} (${this.state.pendingCalls} pending)`,
        { callCount: this.state.callCount, pendingCalls: this.state.pendingCalls, maxCalls: this.budget.maxCalls }
      );
    }

    // Max total spend check (already-committed spend)
    if (this.budget.maxTotalUsdc) {
      const maxMicros = decimalToMicros(this.budget.maxTotalUsdc);
      if (this.state.totalCostMicros >= maxMicros) {
        throw new BrokerError(
          BrokerErrorCode.BUDGET_EXCEEDED,
          `Budget exceeded: spent ${this.state.totalCostMicros} micros, limit ${maxMicros} micros`,
          { spent: this.state.totalCostMicros.toString(), limit: maxMicros.toString() }
        );
      }
    }
  }

  /**
   * Pre-execution spend check for payment tools.
   * Checks requested payment amount against remaining budget BEFORE execution.
   * Prevents a single x402.pay from exceeding the remaining budget.
   */
  assertPaymentBudgetAllowed(toolName: string, args: Record<string, unknown>): void {
    if (!this.budget.maxTotalUsdc) return;

    const requestedMicros = extractCostMicrosFromArgs(toolName, args);
    if (requestedMicros === 0n) return; // Not a payment tool

    const maxMicros = decimalToMicros(this.budget.maxTotalUsdc);
    const remaining = maxMicros - this.state.totalCostMicros;

    if (requestedMicros > remaining) {
      throw new BrokerError(
        BrokerErrorCode.BUDGET_EXCEEDED,
        `Payment ${requestedMicros} micros exceeds remaining budget ${remaining} micros (spent ${this.state.totalCostMicros}/${maxMicros})`,
        {
          requested: requestedMicros.toString(),
          remaining: remaining.toString(),
          spent: this.state.totalCostMicros.toString(),
          limit: maxMicros.toString(),
        }
      );
    }
  }

  /**
   * Get timeout for a specific tool.
   *
   * Precedence:
   * 1. Explicit per-tool override (timeoutOverridesMs[toolName])
   * 2. If non-idempotent write → write default 120s
   * 3. Otherwise → defaultTimeoutMs or 30s
   *
   * This ensures write tools get 120s even when the broker is configured
   * with defaultTimeoutMs=30000 (which is the RunnerConfigSchema default).
   */
  getTimeoutMs(toolName: string): number {
    return this.budget.timeoutOverridesMs?.[toolName]
      ?? (NON_IDEMPOTENT_WRITE_TOOLS.has(toolName)
        ? WRITE_TOOL_TIMEOUT_MS
        : (this.budget.defaultTimeoutMs ?? 30_000));
  }

  /**
   * Get max output size for a specific tool.
   */
  getMaxOutputBytes(toolName: string): number {
    return this.budget.outputSizeOverridesBytes?.[toolName]
      ?? this.maxOutputBytes;
  }

  /**
   * Enforce output size limit.
   * Returns the result if OK, throws if too large.
   */
  assertOutputSize(toolName: string, result: unknown): unknown {
    const size = measureOutputSize(result);
    const limit = this.getMaxOutputBytes(toolName);
    if (size > limit) {
      throw new BrokerError(
        BrokerErrorCode.OUTPUT_TOO_LARGE,
        `Tool '${toolName}' output too large: ${size} bytes (limit: ${limit})`,
        { tool: toolName, size, limit }
      );
    }
    return result;
  }

  /**
   * Record a completed tool call in the audit log and update budget state.
   * Args are redacted before storage to strip sensitive fields.
   */
  recordCall(entry: Omit<AuditEntry, "timestamp">): void {
    this.state.callCount++;

    const fullEntry: AuditEntry = {
      ...entry,
      args: redactArgs(entry.args),
      timestamp: new Date().toISOString(),
    };

    // Track cost if applicable
    if (entry.costUsdc) {
      this.state.totalCostMicros += decimalToMicros(entry.costUsdc);
    }

    this.state.auditLog.push(fullEntry);
  }

  /**
   * Reserve a call slot before execution.
   * Increments pendingCalls to prevent concurrent oversubscription.
   * Call this before dispatching the tool; call releaseCallSlot() when done.
   */
  reserveCallSlot(): void {
    this.state.pendingCalls++;
  }

  /**
   * Release a reserved call slot after execution completes (success or failure).
   */
  releaseCallSlot(): void {
    this.state.pendingCalls = Math.max(0, this.state.pendingCalls - 1);
  }

  /**
   * Record a pre-execution rejection as a failed audit entry.
   * These are the highest-value events for forensics.
   */
  recordRejection(
    toolName: string,
    args: Record<string, unknown>,
    error: BrokerError
  ): void {
    this.recordCall({
      toolName,
      args,
      ok: false,
      durationMs: 0,
      outputBytes: 0,
      errorCode: error.code,
      errorMessage: error.message,
    });
  }

  /**
   * Full pre-execution check: allowlist + schema + budget + payment spend.
   * Reserves a call slot on success; caller must release on completion.
   */
  preExecute(toolName: string, args: Record<string, unknown>): void {
    this.assertToolAllowed(toolName);
    this.validateArgs(toolName, args);
    this.assertBudgetAllowed();
    this.assertPaymentBudgetAllowed(toolName, args);
    this.reserveCallSlot();
  }

  /**
   * Full post-execution check: output size + audit log + cost tracking.
   * Releases the call slot reserved by preExecute.
   */
  postExecute(
    toolName: string,
    args: Record<string, unknown>,
    result: unknown,
    durationMs: number
  ): unknown {
    try {
      // Output size check
      this.assertOutputSize(toolName, result);

      // Extract cost from request args (not result — result doesn't contain amount)
      const costMicros = extractCostMicrosFromArgs(toolName, args);

      // Audit log
      this.recordCall({
        toolName,
        args,
        ok: true,
        durationMs,
        outputBytes: measureOutputSize(result),
        costUsdc: costMicros > 0n ? (Number(costMicros) / 1_000_000).toFixed(6) : undefined,
      });

      return result;
    } finally {
      this.releaseCallSlot();
    }
  }

  /**
   * Record a failed tool call in the audit log.
   * Releases the call slot reserved by preExecute.
   *
   * @param timedOut - true when the failure was a broker timeout and the
   *   underlying operation may still complete (non-idempotent writes).
   */
  recordFailure(
    toolName: string,
    args: Record<string, unknown>,
    error: unknown,
    durationMs: number,
    timedOut = false
  ): void {
    try {
      const isBrokerError = error instanceof BrokerError;
      this.recordCall({
        toolName,
        args,
        ok: false,
        durationMs,
        outputBytes: 0,
        errorCode: isBrokerError ? error.code : BrokerErrorCode.INTERNAL_ERROR,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        timedOut: timedOut && isNonIdempotentWrite(toolName) ? true : undefined,
      });
    } finally {
      this.releaseCallSlot();
    }
  }
}
