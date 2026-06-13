import { describe, it, expect, afterEach } from "vitest";
import { TaskIdempotencyStore, DEFAULT_TASK_IDEMPOTENCY_TTL_MS } from "./task-idempotency";
import { RunnerError } from "./errors";

function expectRunnerError(fn: () => void, code: string) {
  try {
    fn();
    expect.fail(`Expected RunnerError with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RunnerError);
    expect((error as RunnerError).code).toBe(code);
  }
}

describe("TaskIdempotencyStore", () => {
  let store: TaskIdempotencyStore;

  afterEach(() => {
    store?.destroy();
  });

  it("accepts first use of a taskId", () => {
    store = new TaskIdempotencyStore();
    expect(() => store.checkAndMark("task-1", "agent-1")).not.toThrow();
  });

  it("rejects duplicate taskId within TTL", () => {
    store = new TaskIdempotencyStore();
    store.checkAndMark("task-1", "agent-1");
    expectRunnerError(
      () => store.checkAndMark("task-1", "agent-1"),
      "DUPLICATE_TASK"
    );
  });

  it("allows same taskId for different agents", () => {
    store = new TaskIdempotencyStore();
    expect(() => store.checkAndMark("task-1", "agent-1")).not.toThrow();
    expect(() => store.checkAndMark("task-1", "agent-2")).not.toThrow();
  });

  it("has() returns true for tracked taskId", () => {
    store = new TaskIdempotencyStore();
    store.checkAndMark("task-1", "agent-1");
    expect(store.has("task-1", "agent-1")).toBe(true);
  });

  it("has() returns false for untracked taskId", () => {
    store = new TaskIdempotencyStore();
    expect(store.has("task-1", "agent-1")).toBe(false);
  });

  it("get() returns entry with pending status", () => {
    store = new TaskIdempotencyStore();
    store.checkAndMark("task-1", "agent-1");
    const entry = store.get("task-1", "agent-1");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("pending");
    expect(entry!.taskId).toBe("task-1");
  });

  it("markCompleted updates status", () => {
    store = new TaskIdempotencyStore();
    store.checkAndMark("task-1", "agent-1");
    store.markCompleted("task-1", "agent-1");
    const entry = store.get("task-1", "agent-1");
    expect(entry!.status).toBe("completed");
  });

  it("markFailed updates status", () => {
    store = new TaskIdempotencyStore();
    store.checkAndMark("task-1", "agent-1");
    store.markFailed("task-1", "agent-1");
    const entry = store.get("task-1", "agent-1");
    expect(entry!.status).toBe("failed");
  });

  it("reports duplicate status in error message", () => {
    store = new TaskIdempotencyStore();
    store.checkAndMark("task-1", "agent-1");
    store.markCompleted("task-1", "agent-1");
    try {
      store.checkAndMark("task-1", "agent-1");
      expect.fail("Expected RunnerError");
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerError);
      expect((error as RunnerError).message).toContain("completed");
    }
  });

  it("tracks size", () => {
    store = new TaskIdempotencyStore();
    expect(store.size).toBe(0);
    store.checkAndMark("task-1", "agent-1");
    expect(store.size).toBe(1);
    store.checkAndMark("task-2", "agent-1");
    expect(store.size).toBe(2);
  });

  it("cleanup removes expired entries", () => {
    store = new TaskIdempotencyStore(1); // 1ms TTL
    store.checkAndMark("task-1", "agent-1");
    expect(store.size).toBe(1);

    const start = Date.now();
    while (Date.now() - start < 10) {} // busy wait 10ms

    store.cleanup();
    expect(store.size).toBe(0);
  });

  it("destroy clears store and timer", () => {
    store = new TaskIdempotencyStore();
    store.checkAndMark("task-1", "agent-1");
    store.destroy();
    expect(store.size).toBe(0);
  });

  it("default TTL is 24 hours", () => {
    expect(DEFAULT_TASK_IDEMPOTENCY_TTL_MS).toBe(86_400_000);
  });
});
