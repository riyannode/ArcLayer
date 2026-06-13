/**
 * OpenClaw Runtime Adapter — untrusted boundary.
 *
 * OpenClaw is treated as an untrusted runtime behind the Runner boundary.
 * All outbound requests are sanitized. All inbound responses are strictly
 * validated. Error bodies are sanitized before storage.
 */

import type { AgentTask, RuntimeResult } from "@arclayer/runner-core";
import { RunnerError } from "@arclayer/runner-core";
import {
  HttpRuntimeConnector,
  RuntimeErrorCode,
  sanitizeTaskForUntrustedRuntime,
  validateOpenClawResponse,
  mapRuntimeError,
  type RuntimeConnector,
  type RuntimeCapabilities
} from "../runtime-helpers";

export class OpenClawRuntimeConnector extends HttpRuntimeConnector implements RuntimeConnector {
  override readonly kind = "openclaw";
  private readonly maxOutputBytes: number;

  constructor(
    endpoint: string,
    runPath: string = "/run",
    secret?: string,
    timeoutMs: number = 120_000,
    maxOutputBytes: number = 1_048_576
  ) {
    super(endpoint, runPath, secret, timeoutMs);
    this.maxOutputBytes = maxOutputBytes;
  }

  override async run(task: AgentTask): Promise<RuntimeResult> {
    // 1. Sanitize outbound task
    const sanitizedTask = sanitizeTaskForUntrustedRuntime(task);

    try {
      // 2. Use protected fetchRuntime() from base class
      const response = await this.fetchRuntime(sanitizedTask);

      // 3. Parse JSON — reject non-JSON
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new RunnerError(
          RuntimeErrorCode.RUNTIME_INVALID_RESPONSE,
          `OpenClaw returned non-JSON response (HTTP ${response.status})`,
          502
        );
      }

      // 4. Map HTTP errors
      if (!response.ok) {
        throw mapRuntimeError(new Error(`HTTP ${response.status}`), response.status, this.getEndpoint());
      }

      // 5. Strict response validation
      return validateOpenClawResponse(body, this.maxOutputBytes);
    } catch (error: unknown) {
      if (error instanceof RunnerError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw mapRuntimeError(error, undefined, this.getEndpoint());
      }
      throw mapRuntimeError(error, undefined, this.getEndpoint());
    }
  }

  override getCapabilities(): RuntimeCapabilities {
    return {
      supportsArtifacts: true,
      supportsPaymentRequests: false,
      supportsActionRequests: false,
      maxOutputBytes: this.maxOutputBytes,
    };
  }
}
