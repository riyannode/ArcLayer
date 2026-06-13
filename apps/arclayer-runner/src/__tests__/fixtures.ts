/**
 * Test-only fixtures.
 * MockRuntimeConnector lives here — NOT in production source.
 * Import from tests only: import { MockRuntimeConnector } from "./__tests__/fixtures";
 */

import type { RuntimeConnector } from "../runtime";
import type { AgentTask, RuntimeResult } from "@arclayer/runner-core";

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
