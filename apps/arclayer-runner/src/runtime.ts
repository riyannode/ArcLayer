/**
 * Runtime adapter interface, factory, and shared helpers.
 *
 * Concrete adapters live in:
 *   runtimes/hermes.ts  — trusted Hermes runtime
 *   runtimes/openclaw.ts — untrusted OpenClaw runtime (strict boundary)
 *
 * Shared helpers live in:
 *   runtime-helpers.ts  — HttpRuntimeConnector, error mapper, sanitizer, validator
 */

import type { AgentTask, RuntimeResult } from "@arclayer/runner-core";
import { HermesRuntimeConnector } from "./runtimes/hermes";
import { OpenClawRuntimeConnector } from "./runtimes/openclaw";
import { HttpRuntimeConnector } from "./runtime-helpers";

// Re-export everything from runtime-helpers for backward compat
export {
  HttpRuntimeConnector,
  RuntimeErrorCode,
  sanitizeTaskForUntrustedRuntime,
  validateOpenClawResponse,
  mapRuntimeError,
  safeHostFromUrl,
  type RuntimeCapabilities,
} from "./runtime-helpers";

// ── Runtime Connector Interface ─────────────────────────────────────────

export interface RuntimeConnector {
  readonly kind: string;
  run(task: AgentTask): Promise<RuntimeResult>;
  /** Optional health check. Not startup-blocking. For doctor/preflight only. */
  healthCheck?(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
  /** Optional capability declaration. */
  getCapabilities?(): import("./runtime-helpers").RuntimeCapabilities;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createRuntimeConnector(
  kind: string,
  endpoint: string,
  runPath: string,
  secret?: string,
  timeoutMs?: number
): RuntimeConnector {
  const timeout = timeoutMs ?? 120_000;

  switch (kind) {
    case "hermes":
      return new HermesRuntimeConnector(endpoint, runPath, secret, timeout);
    case "openclaw":
      return new OpenClawRuntimeConnector(endpoint, runPath, secret, timeout);
    case "custom":
    default:
      return new HttpRuntimeConnector(endpoint, runPath, secret, timeout);
  }
}
