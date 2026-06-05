/**
 * ArcLayer Global MCP — Error codes, McpError class, and result helpers.
 *
 * All public API surfaces must use these structured helpers instead of
 * raw objects so that error format stays consistent across tools.
 */

// ─── MCP / JSON-RPC ERROR CODES ─────────────────────────────────────────────

export const MCP_ERRORS = {
  /** Request body is not valid JSON or missing required JSON-RPC fields. */
  INVALID_REQUEST: 'INVALID_REQUEST',
  /** The requested JSON-RPC method is not recognised. */
  UNKNOWN_METHOD: 'UNKNOWN_METHOD',
  /** The requested tool name/alias does not exist in the registry. */
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  /** Authentication required but not provided. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Authenticated but insufficient permissions. */
  FORBIDDEN: 'FORBIDDEN',
  /** Resource not found. */
  NOT_FOUND: 'NOT_FOUND',
  /** Missing or malformed required parameters. */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** Conflict with current state (e.g. duplicate registration). */
  CONFLICT: 'CONFLICT',
  /** Unhandled internal error. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type McpErrorCode = (typeof MCP_ERRORS)[keyof typeof MCP_ERRORS];

// ─── MCPERROR CLASS ──────────────────────────────────────────────────────────

export class McpError extends Error {
  readonly code: McpErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: McpErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// ─── RESULT HELPERS ─────────────────────────────────────────────────────────

/** Successful tool/MCP result with optional structured content. */
export function okResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text }],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}

/** Structured error result (does NOT throw). */
export function errorResult(
  code: McpErrorCode,
  message: string,
  status?: number,
  details?: unknown,
) {
  return {
    content: [{ type: 'text', text: `[${code}] ${message}` }],
    isError: true,
    ...(details !== undefined ? { structuredContent: { error: code, message, details } } : {}),
    _status: status ?? 400,
  };
}

/** JSON-RPC 2.0 success envelope. */
export function jsonRpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

/** JSON-RPC 2.0 error envelope. */
export function jsonRpcError(
  id: string | number | null,
  code: McpErrorCode,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: -32000, // JSON-RPC server error range
      message: `[${code}] ${message}`,
      ...(data !== undefined ? { data } : {}),
    },
  };
}

/**
 * Convert any thrown value into a safe MCP error response.
 * Never exposes stack traces or internal details.
 */
export function thrownToMcpError(e: unknown): McpError {
  if (e instanceof McpError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new McpError(MCP_ERRORS.INTERNAL_ERROR, 'Internal error', 500);
}
