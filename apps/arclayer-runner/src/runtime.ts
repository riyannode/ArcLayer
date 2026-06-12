import { RunnerError, RuntimeResultSchema, type AgentTask, type RuntimeResult } from "@arclayer/runner-core";

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

export interface RuntimeConnector {
  readonly kind: string;
  run(task: AgentTask): Promise<RuntimeResult>;
}

export class HttpRuntimeConnector implements RuntimeConnector {
  readonly kind = "http";

  constructor(
    private readonly endpoint: string,
    private readonly runPath: string = "/run",
    private readonly secret?: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  async run(task: AgentTask): Promise<RuntimeResult> {
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
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(task),
        signal: controller.signal
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new RunnerError("RUNTIME_ERROR", `Runtime returned ${response.status}`, 502, body);
      }

      return RuntimeResultSchema.parse(body);
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw new RunnerError(
          "RUNTIME_TIMEOUT",
          `Runtime request timed out after ${this.timeoutMs}ms`,
          504
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class HermesRuntimeConnector implements RuntimeConnector {
  readonly kind = "hermes";
  private readonly http: HttpRuntimeConnector;

  constructor(endpoint: string, runPath: string = "/run", apiKey?: string, timeoutMs?: number) {
    this.http = new HttpRuntimeConnector(endpoint, runPath, apiKey, timeoutMs);
  }

  async run(task: AgentTask): Promise<RuntimeResult> {
    return this.http.run(task);
  }
}

export class OpenClawRuntimeConnector implements RuntimeConnector {
  readonly kind = "openclaw";
  private readonly http: HttpRuntimeConnector;

  constructor(endpoint: string, runPath: string = "/run", apiKey?: string, timeoutMs?: number) {
    this.http = new HttpRuntimeConnector(endpoint, runPath, apiKey, timeoutMs);
  }

  async run(task: AgentTask): Promise<RuntimeResult> {
    return this.http.run(task);
  }
}

export class MockRuntimeConnector implements RuntimeConnector {
  readonly kind = "mock";
  private results: RuntimeResult[] = [];
  private callLog: AgentTask[] = [];

  queueResult(result: RuntimeResult): void {
    this.results.push(result);
  }

  getCallLog(): AgentTask[] {
    return [...this.callLog];
  }

  async run(task: AgentTask): Promise<RuntimeResult> {
    this.callLog.push(task);
    const next = this.results.shift();
    if (!next) {
      return {
        ok: true,
        status: "completed",
        output: { mock: true, taskId: task.taskId },
        artifacts: [],
        paymentRequests: [],
        actionRequests: []
      };
    }
    return next;
  }
}

export function createRuntimeConnector(
  kind: string,
  endpoint: string,
  runPath: string,
  secret?: string
): RuntimeConnector {
  switch (kind) {
    case "hermes":
      return new HermesRuntimeConnector(endpoint, runPath, secret);
    case "openclaw":
      return new OpenClawRuntimeConnector(endpoint, runPath, secret);
    case "custom":
      return new HttpRuntimeConnector(endpoint, runPath, secret);
    default:
      return new HttpRuntimeConnector(endpoint, runPath, secret);
  }
}
