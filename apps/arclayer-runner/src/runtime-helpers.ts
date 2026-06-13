/**
 * Shared runtime helpers — no circular deps.
 *
 * This file contains:
 *   RuntimeConnector interface
 *   RuntimeCapabilities type
 *   HttpRuntimeConnector base class
 *   sanitizeTaskForUntrustedRuntime()
 *   validateOpenClawResponse()
 *   mapRuntimeError()
 *   safeHostFromUrl()
 */

import {
  RunnerError,
  RuntimeResultSchema,
  type AgentTask,
  type RuntimeResult
} from "@arclayer/runner-core";

// ── Runtime Connector Interface ─────────────────────────────────────────

export interface RuntimeCapabilities {
  supportsArtifacts: boolean;
  supportsPaymentRequests: boolean;
  supportsActionRequests: boolean;
  maxOutputBytes: number;
}

export interface RuntimeConnector {
  readonly kind: string;
  run(task: AgentTask): Promise<RuntimeResult>;
  /** Optional health check. Not startup-blocking. For doctor/preflight only. */
  healthCheck?(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
  /** Optional capability declaration. */
  getCapabilities?(): RuntimeCapabilities;
}

// ── Stable Error Codes ──────────────────────────────────────────────────

export const RuntimeErrorCode = {
  RUNTIME_TIMEOUT: "RUNTIME_TIMEOUT",
  RUNTIME_AUTH_FAILED: "RUNTIME_AUTH_FAILED",
  RUNTIME_RATE_LIMITED: "RUNTIME_RATE_LIMITED",
  RUNTIME_UNAVAILABLE: "RUNTIME_UNAVAILABLE",
  RUNTIME_INVALID_RESPONSE: "RUNTIME_INVALID_RESPONSE",
  RUNTIME_ERROR: "RUNTIME_ERROR",
} as const;

// ── Sensitive Metadata Key Patterns ─────────────────────────────────────

const SENSITIVE_KEY_PATTERNS = [
  "secret",
  "token",
  "key",
  "password",
  "authorization",
  "private",
  "wallet",
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

// ── Sanitize Task for Untrusted Runtime ─────────────────────────────────

/**
 * Strip sensitive/internal metadata from an AgentTask before sending
 * to an untrusted runtime (OpenClaw).
 */
export function sanitizeTaskForUntrustedRuntime(task: AgentTask): AgentTask {
  const SAFE_METADATA_KEYS = new Set([
    "jobId",
    "description",
    "traceId",
    "requestId",
  ]);

  const sanitizedMetadata: Record<string, unknown> = {};
  if (task.metadata) {
    for (const [key, value] of Object.entries(task.metadata)) {
      if (SAFE_METADATA_KEYS.has(key)) {
        sanitizedMetadata[key] = value;
      } else if (isSensitiveKey(key)) {
        continue; // Strip sensitive keys silently
      }
      // Strip all other non-safe keys by default
    }
  }

  return {
    taskId: task.taskId,
    protocol: task.protocol,
    role: task.role,
    agentId: task.agentId,
    input: task.input,
    metadata: sanitizedMetadata,
  };
}

// ── OpenClaw Response Validation ────────────────────────────────────────

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576; // 1 MB

export function validateOpenClawResponse(
  result: unknown,
  maxOutputBytes: number = DEFAULT_MAX_OUTPUT_BYTES
): RuntimeResult {
  // Wrap Zod parse — malformed payload must become RUNTIME_INVALID_RESPONSE
  let parsed: RuntimeResult;
  try {
    parsed = RuntimeResultSchema.parse(result);
  } catch {
    throw new RunnerError(
      RuntimeErrorCode.RUNTIME_INVALID_RESPONSE,
      "OpenClaw returned invalid RuntimeResult",
      502
    );
  }

  const outputSize = Buffer.byteLength(JSON.stringify(parsed.output ?? ""), "utf-8");
  if (outputSize > maxOutputBytes) {
    throw new RunnerError(
      RuntimeErrorCode.RUNTIME_INVALID_RESPONSE,
      `Output size ${outputSize} bytes exceeds limit ${maxOutputBytes}`,
      502
    );
  }

  if (parsed.actionRequests && parsed.actionRequests.length > 0) {
    throw new RunnerError(
      RuntimeErrorCode.RUNTIME_INVALID_RESPONSE,
      "OpenClaw runtime must not return actionRequests",
      502
    );
  }

  if (parsed.paymentRequests && parsed.paymentRequests.length > 0) {
    throw new RunnerError(
      RuntimeErrorCode.RUNTIME_INVALID_RESPONSE,
      "OpenClaw runtime paymentRequests not supported in this version",
      502
    );
  }

  if (parsed.artifacts && parsed.artifacts.length > 0) {
    for (const artifact of parsed.artifacts) {
      if (artifact.uri) {
        validateArtifactUri(artifact.uri);
      }
    }
  }

  return parsed;
}

function validateArtifactUri(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new RunnerError(
      RuntimeErrorCode.RUNTIME_INVALID_RESPONSE,
      "Invalid artifact URI: not a valid URL",
      502
    );
  }

  if (parsed.protocol !== "https:") {
    throw new RunnerError(
      RuntimeErrorCode.RUNTIME_INVALID_RESPONSE,
      `Artifact URI must use https:// protocol, got ${parsed.protocol}`,
      502
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new RunnerError(
      RuntimeErrorCode.RUNTIME_INVALID_RESPONSE,
      `Artifact URI must not target internal/private host: ${hostname}`,
      502
    );
  }

  // Block IPv6 loopback and link-local (JS URL API returns [::1] with brackets)
  const bareHostname = hostname.replace(/^\[|\]$/g, "");
  if (
    bareHostname === "::1" ||
    bareHostname.startsWith("fe80:") ||
    bareHostname.startsWith("fc") ||
    bareHostname.startsWith("fd")
  ) {
    throw new RunnerError(
      RuntimeErrorCode.RUNTIME_INVALID_RESPONSE,
      `Artifact URI must not target IPv6 loopback/link-local/private: ${hostname}`,
      502
    );
  }

  if (isPrivateIp(hostname)) {
    throw new RunnerError(
      RuntimeErrorCode.RUNTIME_INVALID_RESPONSE,
      `Artifact URI must not target private IP: ${hostname}`,
      502
    );
  }
}

function isPrivateIp(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;

  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 127.0.0.0/8 (entire loopback range)
  if (parts[0] === 127) return true;
  // 169.254.0.0/16 (link-local / cloud metadata)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 100.64.0.0/10 (CGNAT / shared address space)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

  return false;
}

// ── Runtime Error Mapper ────────────────────────────────────────────────

export function mapRuntimeError(
  error: unknown,
  status?: number,
  endpoint?: string
): RunnerError {
  if (error instanceof Error && error.name === "AbortError") {
    return new RunnerError(
      RuntimeErrorCode.RUNTIME_TIMEOUT,
      "Runtime request timed out",
      504
    );
  }

  const host = endpoint ? safeHostFromUrl(endpoint) : "unknown";

  if (status !== undefined) {
    if (status === 401 || status === 403) {
      return new RunnerError(RuntimeErrorCode.RUNTIME_AUTH_FAILED, `Runtime auth failed (${status}) at ${host}`, 502);
    }
    if (status === 429) {
      return new RunnerError(RuntimeErrorCode.RUNTIME_RATE_LIMITED, `Runtime rate limited at ${host}`, 502);
    }
    if (status === 502 || status === 503 || status === 504) {
      return new RunnerError(RuntimeErrorCode.RUNTIME_UNAVAILABLE, `Runtime unavailable (${status}) at ${host}`, 502);
    }
    if (status >= 400) {
      return new RunnerError(RuntimeErrorCode.RUNTIME_ERROR, `Runtime error (${status}) at ${host}`, 502);
    }
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("econnreset") || msg.includes("fetch failed") || msg.includes("network")) {
      return new RunnerError(RuntimeErrorCode.RUNTIME_UNAVAILABLE, `Runtime unavailable at ${host}: ${sanitizeErrorMessage(error.message)}`, 502);
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return new RunnerError(RuntimeErrorCode.RUNTIME_ERROR, `Runtime error at ${host}: ${sanitizeErrorMessage(message)}`, 502);
}

export function safeHostFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.port ? `:${parsed.port}` : "");
  } catch {
    return "unknown";
  }
}

function sanitizeErrorMessage(msg: string): string {
  let clean = msg.replace(/https?:\/\/[^@\s]+@/g, "https://***@");
  clean = clean.replace(/bearer\s+[a-zA-Z0-9_-]+/gi, "bearer [REDACTED]");
  clean = clean.replace(/0x[a-fA-F0-9]{32,}/g, "0x[REDACTED]");
  if (clean.length > 300) clean = clean.slice(0, 300) + "...";
  return clean;
}

// ── HTTP Runtime Connector (base class) ─────────────────────────────────

export class HttpRuntimeConnector implements RuntimeConnector {
  readonly kind = "http";

  constructor(
    private readonly endpoint: string,
    private readonly runPath: string = "/run",
    private readonly secret?: string,
    private readonly timeoutMs: number = 120_000
  ) {}

  /**
   * Send a request to the runtime and return the raw fetch response.
   * Subclasses can use this for custom response handling.
   */
  protected async fetchRuntime(body: unknown): Promise<Response> {
    const url = new URL(this.runPath, this.endpoint);
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (this.secret) {
      headers.authorization = `Bearer ${this.secret}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Get the endpoint URL for error messages. */
  protected getEndpoint(): string {
    return this.endpoint;
  }

  async run(task: AgentTask): Promise<RuntimeResult> {
    try {
      const response = await this.fetchRuntime(task);
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw mapRuntimeError(new Error(`HTTP ${response.status}`), response.status, this.endpoint);
      }

      if (body === null) {
        throw new RunnerError(RuntimeErrorCode.RUNTIME_INVALID_RESPONSE, "Runtime returned non-JSON response", 502);
      }

      return RuntimeResultSchema.parse(body);
    } catch (error: any) {
      if (error instanceof RunnerError) throw error;
      if (error.name === "AbortError") throw mapRuntimeError(error, undefined, this.endpoint);
      throw mapRuntimeError(error, undefined, this.endpoint);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const startTime = Date.now();
    try {
      const url = new URL("/health", this.endpoint);
      const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5_000) });
      return { ok: response.ok, latencyMs: Date.now() - startTime, error: response.ok ? undefined : `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - startTime, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
