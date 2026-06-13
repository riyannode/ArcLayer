/**
 * Task idempotency store.
 *
 * Prevents duplicate task execution within a TTL window.
 * Tracks taskIds that have been dispatched and their status.
 * In-memory Map with automatic expiry cleanup.
 * For production fleet, swap to Redis-backed implementation.
 */

import { RunnerError } from "./errors";

export type TaskStatus = "pending" | "completed" | "failed";

export type TaskEntry = {
  taskId: string;
  status: TaskStatus;
  createdAt: number;
  expiresAt: number;
};

export const DEFAULT_TASK_IDEMPOTENCY_TTL_MS = 86_400_000; // 24 hours

export class TaskIdempotencyStore {
  private readonly store = new Map<string, TaskEntry>();
  private readonly ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs: number = DEFAULT_TASK_IDEMPOTENCY_TTL_MS) {
    this.ttlMs = ttlMs;

    // Cleanup expired entries every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 300_000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check if a taskId has already been dispatched and mark it as pending.
   * Throws RunnerError(409) if taskId is already tracked within TTL.
   *
   * @param taskId - The task ID from the request
   * @param agentId - The agent ID for namespacing
   */
  checkAndMark(taskId: string, agentId: string): void {
    const key = this.buildKey(taskId, agentId);
    const existing = this.store.get(key);

    if (existing && existing.expiresAt > Date.now()) {
      throw new RunnerError(
        "DUPLICATE_TASK",
        `Task ${taskId} already dispatched (status: ${existing.status})`,
        409
      );
    }

    this.store.set(key, {
      taskId,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs
    });
  }

  /**
   * Mark a task as completed.
   */
  markCompleted(taskId: string, agentId: string): void {
    const key = this.buildKey(taskId, agentId);
    const entry = this.store.get(key);
    if (entry) {
      entry.status = "completed";
    }
  }

  /**
   * Mark a task as failed.
   */
  markFailed(taskId: string, agentId: string): void {
    const key = this.buildKey(taskId, agentId);
    const entry = this.store.get(key);
    if (entry) {
      entry.status = "failed";
    }
  }

  /**
   * Get task entry if it exists.
   */
  get(taskId: string, agentId: string): TaskEntry | undefined {
    const key = this.buildKey(taskId, agentId);
    const entry = this.store.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry;
    return undefined;
  }

  /**
   * Check if a taskId is already tracked (without marking).
   */
  has(taskId: string, agentId: string): boolean {
    return !!this.get(taskId, agentId);
  }

  /**
   * Remove expired entries.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Get current store size (for monitoring/tests).
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Destroy the store and clear the cleanup timer.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }

  private buildKey(taskId: string, agentId: string): string {
    return `${agentId}:${taskId}`;
  }
}
