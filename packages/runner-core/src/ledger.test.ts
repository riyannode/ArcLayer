import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SpendingLedger } from "./ledger";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("SpendingLedger", () => {
  let tempDir: string;
  let ledger: SpendingLedger;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "ledger-test-"));
    ledger = new SpendingLedger(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("records attempt and success as separate events", async () => {
    await ledger.recordAttempt({
      idempotencyKey: "key-1",
      amountUsdc: "0.005",
      amountMicros: "5000"
    });
    await ledger.recordSuccess("key-1", "receipt-1");

    const succeeded = await ledger.hasSucceeded("key-1");
    expect(succeeded).toBeDefined();
    expect(succeeded!.receiptId).toBe("receipt-1");
  });

  it("records attempt and failure as separate events", async () => {
    await ledger.recordAttempt({
      idempotencyKey: "key-2",
      amountUsdc: "0.01",
      amountMicros: "10000"
    });
    await ledger.recordFailure("key-2", "payment_timeout");

    const succeeded = await ledger.hasSucceeded("key-2");
    expect(succeeded).toBeUndefined();
  });

  it("detects pending attempt (attempt without success/failure)", async () => {
    await ledger.recordAttempt({
      idempotencyKey: "pending-1",
      amountUsdc: "0.001",
      amountMicros: "1000"
    });

    const pending = await ledger.hasPendingAttempt("pending-1");
    expect(pending).toBeDefined();

    // After success, no longer pending
    await ledger.recordSuccess("pending-1");
    const notPending = await ledger.hasPendingAttempt("pending-1");
    expect(notPending).toBeUndefined();
  });

  it("does not report pending after failure", async () => {
    await ledger.recordAttempt({
      idempotencyKey: "fail-1",
      amountUsdc: "0.001",
      amountMicros: "1000"
    });
    await ledger.recordFailure("fail-1", "timeout");

    const pending = await ledger.hasPendingAttempt("fail-1");
    expect(pending).toBeUndefined();

    const failed = await ledger.hasFailed("fail-1");
    expect(failed).toBeDefined();
  });

  it("sums successful amounts by day (event-sourced)", async () => {
    const today = new Date().toISOString().slice(0, 10);

    // Two successful payments
    await ledger.recordAttempt({ idempotencyKey: "k1", amountUsdc: "0.005", amountMicros: "5000" });
    await ledger.recordSuccess("k1");
    await ledger.recordAttempt({ idempotencyKey: "k2", amountUsdc: "0.003", amountMicros: "3000" });
    await ledger.recordSuccess("k2");

    // Failed payment (should not count)
    await ledger.recordAttempt({ idempotencyKey: "k3", amountUsdc: "0.01", amountMicros: "10000" });
    await ledger.recordFailure("k3", "error");

    // Pending payment (should not count)
    await ledger.recordAttempt({ idempotencyKey: "k4", amountUsdc: "0.01", amountMicros: "10000" });

    const sum = await ledger.sumSuccessfulByDay(today);
    expect(sum).toBe(8000n);
  });

  it("sums successful amounts by month (event-sourced)", async () => {
    const month = new Date().toISOString().slice(0, 7);

    await ledger.recordAttempt({ idempotencyKey: "m1", amountUsdc: "0.5", amountMicros: "500000" });
    await ledger.recordSuccess("m1");

    const sum = await ledger.sumSuccessfulByMonth(month);
    expect(sum).toBe(500000n);
  });

  it("lists records most recent first", async () => {
    await ledger.recordAttempt({ idempotencyKey: "a", amountUsdc: "0.001", amountMicros: "1000" });
    await ledger.recordAttempt({ idempotencyKey: "b", amountUsdc: "0.002", amountMicros: "2000" });

    const list = await ledger.list();
    expect(list.length).toBe(2);
    expect(list[0].idempotencyKey).toBe("b");
    expect(list[1].idempotencyKey).toBe("a");
  });
});
