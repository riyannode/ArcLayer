/**
 * Nonce replay protection store.
 *
 * Prevents HMAC nonce reuse within a TTL window.
 * In-memory Map with automatic expiry cleanup.
 * For production fleet, swap to Redis-backed implementation.
 */

import { RunnerError } from "./errors";

export type NonceEntry = {
  nonce: string;
  runnerId: string;
  expiresAt: number;
};

export const DEFAULT_NONCE_TTL_MS = 300_000; // 5 minutes

export class NonceStore {
  private readonly store = new Map<string, NonceEntry>();
  private readonly ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs: number = DEFAULT_NONCE_TTL_MS) {
    this.ttlMs = ttlMs;

    // Cleanup expired nonces every 60 seconds
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    // Allow process to exit even if timer is active
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check if a nonce has been used and mark it as used.
   * Throws RunnerError(409) if nonce is already used within TTL.
   *
   * @param nonce - The nonce string from the request
   * @param runnerId - The runner ID for namespacing
   */
  checkAndMark(nonce: string, runnerId: string): void {
    const key = this.buildKey(nonce, runnerId);
    const existing = this.store.get(key);

    if (existing && existing.expiresAt > Date.now()) {
      throw new RunnerError(
        "NONCE_REPLAY",
        `Nonce ${nonce.slice(0, 8)}... already used (replay detected)`,
        409
      );
    }

    // Store with expiry
    this.store.set(key, {
      nonce,
      runnerId,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  /**
   * Check if a nonce exists without marking it.
   * Used for pre-validation.
   */
  has(nonce: string, runnerId: string): boolean {
    const key = this.buildKey(nonce, runnerId);
    const entry = this.store.get(key);
    return !!entry && entry.expiresAt > Date.now();
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

  private buildKey(nonce: string, runnerId: string): string {
    return `${runnerId}:${nonce}`;
  }
}
