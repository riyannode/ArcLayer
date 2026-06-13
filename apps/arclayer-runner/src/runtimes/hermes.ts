/**
 * Hermes Runtime Adapter — trusted runtime.
 *
 * Hermes is the primary trusted runtime. It receives the full AgentTask
 * (including internal metadata), normalizes output through RuntimeResultSchema,
 * and maps errors to stable RunnerError codes.
 */

import {
  HttpRuntimeConnector,
  type RuntimeConnector,
  type RuntimeCapabilities
} from "../runtime-helpers";

export class HermesRuntimeConnector extends HttpRuntimeConnector implements RuntimeConnector {
  override readonly kind = "hermes";

  constructor(
    endpoint: string,
    runPath: string = "/run",
    secret?: string,
    timeoutMs: number = 120_000
  ) {
    super(endpoint, runPath, secret, timeoutMs);
  }

  // run() inherited from HttpRuntimeConnector — trusted, full task, no sanitization

  override getCapabilities(): RuntimeCapabilities {
    return {
      supportsArtifacts: true,
      supportsPaymentRequests: true,
      supportsActionRequests: true,
      maxOutputBytes: 1_048_576,
    };
  }
}
