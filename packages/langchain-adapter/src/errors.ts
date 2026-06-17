/**
 * @arclayer/langchain-adapter — Custom error classes.
 *
 * All errors redact secrets. Never expose runnerSecret, signature, or auth headers.
 */

export class ArcLayerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ArcLayerError";
  }
}

export class ArcLayerRunnerAuthError extends ArcLayerError {
  constructor(message: string) {
    super("AUTH_FAILED", message, 401);
    this.name = "ArcLayerRunnerAuthError";
  }
}

export class ArcLayerRunnerTimeoutError extends ArcLayerError {
  constructor(timeoutMs: number) {
    super(
      "TIMEOUT",
      `Runner request timed out after ${timeoutMs}ms`,
      408,
    );
    this.name = "ArcLayerRunnerTimeoutError";
  }
}

export class ArcLayerRunnerProtocolError extends ArcLayerError {
  constructor(message: string) {
    super("PROTOCOL_ERROR", message, 502);
    this.name = "ArcLayerRunnerProtocolError";
  }
}

export class ArcLayerPolicyError extends ArcLayerError {
  constructor(message: string) {
    super("POLICY_VIOLATION", message, 403);
    this.name = "ArcLayerPolicyError";
  }
}

export class ArcLayerToolDeniedError extends ArcLayerError {
  constructor(toolName: string) {
    super(
      "TOOL_DENIED",
      `Tool '${toolName}' is not allowed for the current role or configuration`,
      403,
    );
    this.name = "ArcLayerToolDeniedError";
  }
}
