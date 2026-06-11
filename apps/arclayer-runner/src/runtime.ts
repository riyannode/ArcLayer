import { RunnerError, RuntimeResultSchema, type AgentTask, type RuntimeResult } from "@arclayer/runner-core";

/**
 * Runtime connector interface.
 * All LLM runtimes (Hermes, OpenClaw, custom) implement this.
 */
export interface RuntimeConnector {
  readonly kind: string;
  run(task: AgentTask): Promise<RuntimeResult>;
}

/**
 * HTTP runtime connector.
 * Posts task to configurable path (default /run) on the runtime endpoint.
 * Path is configurable via ARCLAYER_RUNTIME_RUN_PATH.
 */
export class HttpRuntimeConnector implements RuntimeConnector {
  readonly kind = "http";

  constructor(
    private readonly endpoint: string,
    private readonly runPath: string = "/run",
    private readonly secret?: string
  ) {}

  async run(task: AgentTask): Promise<RuntimeResult> {
    const url = new URL(this.runPath, this.endpoint);
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (this.secret) {
      headers.authorization = `Bearer ${this.secret}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(task)
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new RunnerError("RUNTIME_ERROR", `Runtime returned ${response.status}`, 502, body);
    }

    return RuntimeResultSchema.parse(body);
  }
}

/**
 * Hermes-specific runtime connector.
 * Same as HttpRuntimeConnector but with Hermes API key auth.
 */
export class HermesRuntimeConnector implements RuntimeConnector {
  readonly kind = "hermes";
  private readonly http: HttpRuntimeConnector;

  constructor(endpoint: string, runPath: string = "/run", apiKey?: string) {
    this.http = new HttpRuntimeConnector(endpoint, runPath, apiKey);
  }

  async run(task: AgentTask): Promise<RuntimeResult> {
    return this.http.run(task);
  }
}

/**
 * OpenClaw-specific runtime connector.
 * Same as HttpRuntimeConnector but with OpenClaw API key auth.
 */
export class OpenClawRuntimeConnector implements RuntimeConnector {
  readonly kind = "openclaw";
  private readonly http: HttpRuntimeConnector;

  constructor(endpoint: string, runPath: string = "/run", apiKey?: string) {
    this.http = new HttpRuntimeConnector(endpoint, runPath, apiKey);
  }

  async run(task: AgentTask): Promise<RuntimeResult> {
    return this.http.run(task);
  }
}

/**
 * Mock runtime connector for tests.
 * Returns pre-configured results.
 */
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

/**
 * Create a runtime connector based on config.
 */
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
