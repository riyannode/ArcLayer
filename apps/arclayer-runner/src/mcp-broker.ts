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
import { getToolByName, type RunnerToolRegistryItem } from "./tool-registry";

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

export type AuditEntry = {
  timestamp: string;
  toolName: string;
  args: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  outputBytes: number;
  errorCode?: BrokerErrorCode;
  errorMessage?: string;
  /** USDC cost if this was a payment tool */
  costUsdc?: string;
};

export type BrokerSessionState = {
  callCount: number;
  totalCostMicros: bigint;
  auditLog: AuditEntry[];
};

// ── Schema Validation ─────────────────────────────────────────────────────

/**
 * Validate tool arguments against the tool's inputSchema from mcp-schemas.
 * Returns null if valid, BrokerError if invalid.
 *
 * This is a pragmatic validator — checks required fields and type hints.
 * Not a full JSON Schema validator (would add dependency); covers the 90% case.
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
      const typeOk =
        (expectedType === "string" && actualType === "string") ||
        (expectedType === "number" && actualType === "number") ||
        (expectedType === "boolean" && actualType === "boolean") ||
        (expectedType === "object" && (actualType === "object" && !Array.isArray(value))) ||
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
 * Extract USDC cost from a tool result if applicable (payment tools).
 * Returns micros as bigint, or 0n if not a payment result.
 */
function extractCostMicros(toolName: string, result: unknown): bigint {
  // Payment tools return { ok: true, result: { amount: "..." } } or similar
  // We look for known payment tool patterns
  if (!toolName.startsWith("x402.")) return 0n;

  try {
    const r = result as Record<string, unknown>;
    if (!r?.ok) return 0n;

    // x402.pay returns result with amount info
    const inner = r.result as Record<string, unknown> | undefined;
    if (inner?.amount && typeof inner.amount === "string") {
      return decimalToMicros(inner.amount);
    }

    // x402.batch_pay returns results array
    if (Array.isArray(inner?.results)) {
      let total = 0n;
      for (const item of inner.results) {
        const itemRecord = item as Record<string, unknown>;
        if (itemRecord?.amount && typeof itemRecord.amount === "string") {
          total += decimalToMicros(itemRecord.amount);
        }
      }
      return total;
    }
  } catch {
    // Not a payment result or unexpected shape
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
   */
  assertBudgetAllowed(): void {
    // Max calls check
    if (this.budget.maxCalls !== undefined && this.state.callCount >= this.budget.maxCalls) {
      throw new BrokerError(
        BrokerErrorCode.MAX_CALLS_EXCEEDED,
        `Tool call limit exceeded: ${this.state.callCount}/${this.budget.maxCalls}`,
        { callCount: this.state.callCount, maxCalls: this.budget.maxCalls }
      );
    }

    // Max total spend check
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
   * Get timeout for a specific tool.
   */
  getTimeoutMs(toolName: string): number {
    return this.budget.timeoutOverridesMs?.[toolName]
      ?? this.budget.defaultTimeoutMs
      ?? 30_000;
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
   */
  recordCall(entry: Omit<AuditEntry, "timestamp">): void {
    this.state.callCount++;

    const fullEntry: AuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    // Track cost if applicable
    if (entry.costUsdc) {
      this.state.totalCostMicros += decimalToMicros(entry.costUsdc);
    }

    this.state.auditLog.push(fullEntry);
  }

  /**
   * Full pre-execution check: allowlist + schema + budget.
   */
  preExecute(toolName: string, args: Record<string, unknown>): void {
    this.assertToolAllowed(toolName);
    this.validateArgs(toolName, args);
    this.assertBudgetAllowed();
  }

  /**
   * Full post-execution check: output size + audit log + cost tracking.
   */
  postExecute(
    toolName: string,
    args: Record<string, unknown>,
    result: unknown,
    durationMs: number
  ): unknown {
    // Output size check
    this.assertOutputSize(toolName, result);

    // Extract cost for payment tools
    const costMicros = extractCostMicros(toolName, result);

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
  }

  /**
   * Record a failed tool call in the audit log.
   */
  recordFailure(
    toolName: string,
    args: Record<string, unknown>,
    error: unknown,
    durationMs: number
  ): void {
    const isBrokerError = error instanceof BrokerError;
    this.recordCall({
      toolName,
      args,
      ok: false,
      durationMs,
      outputBytes: 0,
      errorCode: isBrokerError ? error.code : BrokerErrorCode.INTERNAL_ERROR,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
