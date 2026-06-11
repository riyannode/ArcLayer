import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LedgerRecord } from "./types";

/**
 * Persistent JSONL spending ledger.
 * All spending limits are computed from stored records, not in-memory counters.
 * Survives restarts.
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

  private async appendRecord(record: LedgerRecord): Promise<LedgerRecord> {
    await this.ensureDir();
    let existing = "";
    try {
      existing = await readFile(this.filePath, "utf8");
    } catch {
      existing = "";
    }
    await writeFile(this.filePath, existing + JSON.stringify(record) + "\n", "utf8");
    return record;
  }

  /**
   * Record a payment attempt. Returns the ledger record.
   * Does NOT check idempotency — caller must check first.
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
    return this.appendRecord(record);
  }

  /**
   * Mark an attempt as succeeded. Updates the existing record in-place.
   */
  async recordSuccess(idempotencyKey: string, receiptId?: string): Promise<void> {
    const records = await this.readAll();
    const target = records.find(
      (r) => r.idempotencyKey === idempotencyKey && r.status === "attempt"
    );
    if (target) {
      target.status = "success";
      target.receiptId = receiptId;
      await this.rewriteAll(records);
    }
  }

  /**
   * Mark an attempt as failed.
   */
  async recordFailure(idempotencyKey: string, error: string): Promise<void> {
    const records = await this.readAll();
    const target = records.find(
      (r) => r.idempotencyKey === idempotencyKey && r.status === "attempt"
    );
    if (target) {
      target.status = "failure";
      target.error = error;
      await this.rewriteAll(records);
    }
  }

  /**
   * Check if idempotencyKey already succeeded.
   */
  async hasSucceeded(idempotencyKey: string): Promise<LedgerRecord | undefined> {
    const records = await this.readAll();
    return records.find(
      (r) => r.idempotencyKey === idempotencyKey && r.status === "success"
    );
  }

  /**
   * Check if idempotencyKey has a pending attempt (not yet success/failure).
   */
  async hasPendingAttempt(idempotencyKey: string): Promise<LedgerRecord | undefined> {
    const records = await this.readAll();
    return records.find(
      (r) => r.idempotencyKey === idempotencyKey && r.status === "attempt"
    );
  }

  /**
   * Sum successful payments for a given day (YYYY-MM-DD).
   */
  async sumSuccessfulByDay(dayBucket: string): Promise<bigint> {
    const records = await this.readAll();
    return records
      .filter((r) => r.status === "success" && r.dayBucket === dayBucket)
      .reduce((sum, r) => sum + BigInt(r.amountMicros), 0n);
  }

  /**
   * Sum successful payments for a given month (YYYY-MM).
   */
  async sumSuccessfulByMonth(monthBucket: string): Promise<bigint> {
    const records = await this.readAll();
    return records
      .filter((r) => r.status === "success" && r.monthBucket === monthBucket)
      .reduce((sum, r) => sum + BigInt(r.amountMicros), 0n);
  }

  /**
   * Get recent ledger records (most recent first).
   */
  async list(limit = 100): Promise<LedgerRecord[]> {
    const records = await this.readAll();
    return records.slice(-limit).reverse();
  }

  private async rewriteAll(records: LedgerRecord[]): Promise<void> {
    await this.ensureDir();
    const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await writeFile(this.filePath, content, "utf8");
  }
}
