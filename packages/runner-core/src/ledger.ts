import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LedgerRecord } from "./types";

/**
 * Per-process write mutex. Prevents interleaved JSONL writes
 * when multiple async operations complete concurrently.
 */
let writeMutex: Promise<void> = Promise.resolve();

function withLock(fn: () => Promise<void>): Promise<void> {
  writeMutex = writeMutex.then(fn, fn);
  return writeMutex;
}

/**
 * Persistent append-only JSONL spending ledger.
 *
 * Event-sourced model: attempt, success, and failure are separate events.
 * No record is ever mutated or rewritten. Queries scan events.
 * Uses fs.appendFile for atomic-ish writes.
 *
 * NOTE: JSONL is local single-runner storage, not multi-process DB.
 * Multiple runner processes must not share the same dataDir.
 */
export class SpendingLedger {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "spending-ledger.jsonl");
  }

  private async ensureDir(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
  }

  private async readAll(): Promise<LedgerRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LedgerRecord);
    } catch {
      return [];
    }
  }

  /**
   * Append a single event to the ledger. Uses fs.appendFile with mutex.
   * Never rewrites the file.
   */
  private async appendEvent(record: LedgerRecord): Promise<LedgerRecord> {
    await this.ensureDir();
    await withLock(async () => {
      await appendFile(this.filePath, JSON.stringify(record) + "\n", "utf8");
    });
    return record;
  }

  /**
   * Record a payment attempt event.
   */
  async recordAttempt(input: {
    idempotencyKey: string;
    amountUsdc: string;
    amountMicros: string;
    url?: string;
    reason?: string;
  }): Promise<LedgerRecord> {
    const now = new Date();
    const record: LedgerRecord = {
      id: randomUUID(),
      createdAt: now.toISOString(),
      idempotencyKey: input.idempotencyKey,
      status: "attempt",
      amountUsdc: input.amountUsdc,
      amountMicros: input.amountMicros,
      dayBucket: now.toISOString().slice(0, 10),
      monthBucket: now.toISOString().slice(0, 7),
      url: input.url,
      reason: input.reason
    };
    return this.appendEvent(record);
  }

  /**
   * Record a success event (append-only, does not mutate attempt).
   */
  async recordSuccess(idempotencyKey: string, receiptId?: string): Promise<LedgerRecord> {
    const now = new Date();
    const record: LedgerRecord = {
      id: randomUUID(),
      createdAt: now.toISOString(),
      idempotencyKey,
      status: "success",
      amountUsdc: "0",
      amountMicros: "0",
      dayBucket: now.toISOString().slice(0, 10),
      monthBucket: now.toISOString().slice(0, 7),
      receiptId
    };
    return this.appendEvent(record);
  }

  /**
   * Record a failure event (append-only, does not mutate attempt).
   */
  async recordFailure(idempotencyKey: string, error: string): Promise<LedgerRecord> {
    const now = new Date();
    const record: LedgerRecord = {
      id: randomUUID(),
      createdAt: now.toISOString(),
      idempotencyKey,
      status: "failure",
      amountUsdc: "0",
      amountMicros: "0",
      dayBucket: now.toISOString().slice(0, 10),
      monthBucket: now.toISOString().slice(0, 7),
      error
    };
    return this.appendEvent(record);
  }

  /**
   * Check if idempotencyKey has a success event.
   */
  async hasSucceeded(idempotencyKey: string): Promise<LedgerRecord | undefined> {
    const records = await this.readAll();
    return records.find(
      (r) => r.idempotencyKey === idempotencyKey && r.status === "success"
    );
  }

  /**
   * Check if idempotencyKey has a pending attempt (attempt with no matching success/failure).
   */
  async hasPendingAttempt(idempotencyKey: string): Promise<LedgerRecord | undefined> {
    const records = await this.readAll();
    const events = records.filter((r) => r.idempotencyKey === idempotencyKey);
    const hasAttempt = events.some((r) => r.status === "attempt");
    const hasTerminal = events.some((r) => r.status === "success" || r.status === "failure");
    if (hasAttempt && !hasTerminal) {
      return events.find((r) => r.status === "attempt");
    }
    return undefined;
  }

  /**
   * Check if idempotencyKey has a failure event (for retry policy).
   */
  async hasFailed(idempotencyKey: string): Promise<LedgerRecord | undefined> {
    const records = await this.readAll();
    return records.find(
      (r) => r.idempotencyKey === idempotencyKey && r.status === "failure"
    );
  }

  /**
   * Sum successful payment amounts for a given day (YYYY-MM-DD).
   * Reads amount from the attempt event (success events carry 0 amount).
   */
  async sumSuccessfulByDay(dayBucket: string): Promise<bigint> {
    const records = await this.readAll();
    // Collect succeeded keys
    const succeededKeys = new Set(
      records.filter((r) => r.status === "success").map((r) => r.idempotencyKey)
    );
    // Sum amounts from attempt events whose key has a success event
    return records
      .filter((r) => r.status === "attempt" && succeededKeys.has(r.idempotencyKey) && r.dayBucket === dayBucket)
      .reduce((sum, r) => sum + BigInt(r.amountMicros), 0n);
  }

  /**
   * Sum successful payment amounts for a given month (YYYY-MM).
   */
  async sumSuccessfulByMonth(monthBucket: string): Promise<bigint> {
    const records = await this.readAll();
    const succeededKeys = new Set(
      records.filter((r) => r.status === "success").map((r) => r.idempotencyKey)
    );
    return records
      .filter((r) => r.status === "attempt" && succeededKeys.has(r.idempotencyKey) && r.monthBucket === monthBucket)
      .reduce((sum, r) => sum + BigInt(r.amountMicros), 0n);
  }

  /**
   * Get recent ledger records (most recent first).
   */
  async list(limit = 100): Promise<LedgerRecord[]> {
    const records = await this.readAll();
    return records.slice(-limit).reverse();
  }
}
