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
