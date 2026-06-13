import { describe, it, expect, afterEach } from "vitest";
import { NonceStore, DEFAULT_NONCE_TTL_MS } from "./nonce-store";
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

describe("NonceStore", () => {
  let store: NonceStore;

  afterEach(() => {
    store?.destroy();
  });

  it("accepts first use of a nonce", () => {
    store = new NonceStore();
    expect(() => store.checkAndMark("nonce-1", "runner-1")).not.toThrow();
  });

  it("rejects duplicate nonce within TTL", () => {
    store = new NonceStore();
    store.checkAndMark("nonce-1", "runner-1");
    expectRunnerError(
      () => store.checkAndMark("nonce-1", "runner-1"),
      "NONCE_REPLAY"
    );
  });

  it("allows same nonce for different runners", () => {
    store = new NonceStore();
    expect(() => store.checkAndMark("nonce-1", "runner-1")).not.toThrow();
    expect(() => store.checkAndMark("nonce-1", "runner-2")).not.toThrow();
  });

  it("has() returns true for used nonce", () => {
    store = new NonceStore();
    store.checkAndMark("nonce-1", "runner-1");
    expect(store.has("nonce-1", "runner-1")).toBe(true);
  });

  it("has() returns false for unused nonce", () => {
    store = new NonceStore();
    expect(store.has("nonce-1", "runner-1")).toBe(false);
  });

  it("has() returns false for different runner", () => {
    store = new NonceStore();
    store.checkAndMark("nonce-1", "runner-1");
    expect(store.has("nonce-1", "runner-2")).toBe(false);
  });

  it("tracks size", () => {
    store = new NonceStore();
    expect(store.size).toBe(0);
    store.checkAndMark("nonce-1", "runner-1");
    expect(store.size).toBe(1);
    store.checkAndMark("nonce-2", "runner-1");
    expect(store.size).toBe(2);
  });

  it("cleanup removes expired entries", () => {
    // Use very short TTL
    store = new NonceStore(1); // 1ms TTL
    store.checkAndMark("nonce-1", "runner-1");
    expect(store.size).toBe(1);

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 10) {} // busy wait 10ms

    store.cleanup();
    expect(store.size).toBe(0);
  });

  it("destroy clears store and timer", () => {
    store = new NonceStore();
    store.checkAndMark("nonce-1", "runner-1");
    store.destroy();
    expect(store.size).toBe(0);
  });

  it("default TTL is 5 minutes", () => {
    expect(DEFAULT_NONCE_TTL_MS).toBe(300_000);
  });
});
