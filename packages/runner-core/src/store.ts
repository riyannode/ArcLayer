import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ReceiptRecord } from "./types";

/**
 * Per-process write mutex for receipt store.
 */
let receiptMutex: Promise<void> = Promise.resolve();

function withLock(fn: () => Promise<void>): Promise<void> {
  receiptMutex = receiptMutex.then(fn, fn);
  return receiptMutex;
}

/**
 * Append-only JSONL receipt store.
 * Uses fs.appendFile for atomic-ish writes. Never rewrites.
 *
 * NOTE: JSONL is local single-runner storage, not multi-process DB.
 */
export class JsonlReceiptStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "receipts.jsonl");
  }

  async append(record: Omit<ReceiptRecord, "id" | "createdAt">): Promise<ReceiptRecord> {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    const full: ReceiptRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...record
    };

    await withLock(async () => {
      await appendFile(this.filePath, JSON.stringify(full) + "\n", "utf8");
    });

    return full;
  }

  async list(limit = 100): Promise<ReceiptRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ReceiptRecord)
        .slice(-limit)
        .reverse();
    } catch {
      return [];
    }
  }

  /**
   * Find receipt by idempotency key (for dedup).
   */
  async findByIdempotencyKey(key: string): Promise<ReceiptRecord | undefined> {
    const records = await this.list(10000);
    return records.find((r) => r.idempotencyKey === key);
  }
}
