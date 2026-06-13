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

    // 2. Use protected fetchRuntime() — keep timeout alive during body read
    let fetchResult: { response: Response; done: () => void };
    try {
      fetchResult = await this.fetchRuntime(sanitizedTask);
    } catch (error: unknown) {
      // fetchRuntime throws AbortError on timeout, or network errors
      if (error instanceof RunnerError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw mapRuntimeError(error, undefined, this.getEndpoint());
      }
      throw mapRuntimeError(error, undefined, this.getEndpoint());
    }
    const { response, done } = fetchResult;

    try {
      // 3. Map HTTP errors BEFORE JSON parsing — non-2xx may return HTML/plaintext
      if (!response.ok) {
        throw mapRuntimeError(new Error(`HTTP ${response.status}`), response.status, this.getEndpoint());
      }

      // 4. Parse JSON — reject non-JSON for 2xx responses
      // AbortError during body read must propagate as RUNTIME_TIMEOUT,
      // NOT be swallowed as RUNTIME_INVALID_RESPONSE.
      let body: unknown;
      try {
        body = await response.json();
      } catch (parseError: unknown) {
        if (parseError instanceof Error && parseError.name === "AbortError") {
          throw parseError; // re-throw — outer catch maps to RUNTIME_TIMEOUT
        }
        throw new RunnerError(
          RuntimeErrorCode.RUNTIME_INVALID_RESPONSE,
          `OpenClaw returned non-JSON response (HTTP ${response.status})`,
          502
        );
      }

      // 5. Strict response validation
      return validateOpenClawResponse(body, this.maxOutputBytes);
    } catch (error: unknown) {
      if (error instanceof RunnerError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw mapRuntimeError(error, undefined, this.getEndpoint());
      }
      throw mapRuntimeError(error, undefined, this.getEndpoint());
    } finally {
      done();
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
