import fs from "node:fs";
import path from "node:path";
import { usdcToMicros, microsToUsdc } from "./spend-policy";

export type SpendLedgerEntry = {
  id: string;
  walletAddress: string;
  agentId: string;
  action: string;
  amountUsdc: string;
  state: "reserved" | "confirmed" | "failed" | "cancelled";
  operationId?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

export class SpendLedger {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "spend-ledger.jsonl");
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, "");
    }
  }

  list(): SpendLedgerEntry[] {
    const raw = fs.readFileSync(this.filePath, "utf8").trim();
    if (!raw) return [];
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SpendLedgerEntry);
  }

  append(entry: SpendLedgerEntry): void {
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
  }

  /** Mark a reserved entry as confirmed or failed by operationId or idempotencyKey. */
  markState(filter: { operationId?: string; idempotencyKey?: string }, newState: "confirmed" | "failed"): boolean {
    const entries = this.list();
    let changed = false;
    for (const entry of entries) {
      if (entry.state !== "reserved") continue;
      const matchOp = filter.operationId && entry.operationId === filter.operationId;
      const matchKey = filter.idempotencyKey && entry.idempotencyKey === filter.idempotencyKey;
      if (matchOp || matchKey) {
        entry.state = newState;
        entry.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) {
      const tmpPath = this.filePath + ".tmp";
      const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
      fs.writeFileSync(tmpPath, content);
      fs.renameSync(tmpPath, this.filePath);
    }
    return changed;
  }

  getSpent(input: {
    walletAddress: string;
    window: "daily" | "monthly";
    now?: Date;
  }): string {
    const now = input.now ?? new Date();
    const total = this.list()
      .filter((entry) => {
        if (entry.walletAddress.toLowerCase() !== input.walletAddress.toLowerCase()) {
          return false;
        }
        if (entry.state !== "reserved" && entry.state !== "confirmed") {
          return false;
        }
        const date = new Date(entry.createdAt);
        if (input.window === "daily") {
          return (
            date.getUTCFullYear() === now.getUTCFullYear() &&
            date.getUTCMonth() === now.getUTCMonth() &&
            date.getUTCDate() === now.getUTCDate()
          );
        }
        return (
          date.getUTCFullYear() === now.getUTCFullYear() &&
          date.getUTCMonth() === now.getUTCMonth()
        );
      })
      .reduce((sum, entry) => sum + usdcToMicros(entry.amountUsdc), 0n);

    return microsToUsdc(total);
  }
}
