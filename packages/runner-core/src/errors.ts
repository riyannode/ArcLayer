export class RunnerError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "RunnerError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function asRunnerError(error: unknown): RunnerError {
  if (error instanceof RunnerError) return error;
  if (error instanceof Error) return new RunnerError("INTERNAL_ERROR", error.message, 500);
  return new RunnerError("INTERNAL_ERROR", "Unknown error", 500, error);
}
