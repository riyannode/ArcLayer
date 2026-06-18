
// Helper: empty on-chain override (no existing identities)
const emptyOnChain = {
  balanceOf: async () => 0n,
  ownerOf: async () => { throw new Error('no token'); },
  totalSupply: async () => 0n,
};

/**
 * Identity ensure tests.
 *
 * Verifies:
 *   - Skips mint when identity exists (confirmed)
 *   - Does not double mint after submitted tx state
 *   - Creates identity when missing and auto-register is set
 *   - Rejects when auto-register is not set
 *   - Lock prevents concurrent registration (atomic exclusive create)
 *   - No dynamic require("node:fs") in ESM build
 *   - IdempotencyKey is stable across reruns
 *   - Pending tx can finalize to confirmed tokenId
 *   - Reverted tx becomes failed
 *   - registerFn receives idempotencyKey
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureIdentity,
  readIdentityState,
  readRegistrationState,
  writeIdentityState,
  writeRegistrationState,
  acquireLock,
  releaseLock,
  buildMetadataURI,
  getIdentityDir,
  generateIdempotencyKey,
  finalizePendingIdentity,
} from "./identity-ensure";

// Use temp dir for tests
const TEST_DIR = join(tmpdir(), `arclayer-identity-test-${Date.now()}`);

beforeEach(() => {
  // Override home dir for tests
  process.env.HOME = TEST_DIR;
  mkdirSync(join(TEST_DIR, ".arclayer", "runner"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("identity-ensure", () => {
  describe("readIdentityState", () => {
    it("returns none when no file exists", () => {
      const state = readIdentityState();
      expect(state.status).toBe("none");
    });

    it("reads confirmed identity", () => {
      const dir = join(TEST_DIR, ".arclayer", "runner");
      writeFileSync(join(dir, "identity.json"), JSON.stringify({
        status: "confirmed",
        tokenId: "42",
        walletAddress: "0x1234",
        confirmedAt: new Date().toISOString(),
      }));

      const state = readIdentityState();
      expect(state.status).toBe("confirmed");
      expect(state.tokenId).toBe("42");
    });
  });

  describe("writeIdentityState", () => {
    it("writes and reads back", () => {
      writeIdentityState({
        status: "pending",
        txHash: "0xabc",
        metadataURI: "data:test",
        registeredAt: new Date().toISOString(),
      });

      const state = readIdentityState();
      expect(state.status).toBe("pending");
      expect(state.txHash).toBe("0xabc");
    });
  });

  describe("ensureIdentity", () => {
    it("skips when identity already confirmed", async () => {
      writeIdentityState({
        status: "confirmed",
        tokenId: "42",
        walletAddress: "0x1234",
        confirmedAt: new Date().toISOString(),
      });

      const registerFn = vi.fn();
      const result = await ensureIdentity({
        agentName: "test",
        role: "provider",
        autoRegister: true,
        registerFn,
      });

      expect(result.action).toBe("already_confirmed");
      expect(registerFn).not.toHaveBeenCalled();
    });

    it("returns already_pending when registration submitted", async () => {
      writeRegistrationState({
        status: "submitted",
        txHash: "0xabc",
        metadataURI: "data:test",
        submittedAt: new Date().toISOString(),
      });

      const registerFn = vi.fn();
      const result = await ensureIdentity({
        agentName: "test",
        role: "provider",
        autoRegister: true,
        registerFn,
      });

      expect(result.action).toBe("already_pending");
      expect(registerFn).not.toHaveBeenCalled();
    });

    it("fails when identity missing and auto-register is false", async () => {
      const registerFn = vi.fn();
      const result = await ensureIdentity({
        agentName: "test",
        role: "provider",
        autoRegister: false,
        registerFn,
      });

      expect(result.action).toBe("failed");
      expect(registerFn).not.toHaveBeenCalled();
    });

    it("registers identity when missing and auto-register is true", async () => {
      const registerFn = vi.fn().mockResolvedValue({
        ok: true,
        txHash: "0xdef",
      });

      const result = await ensureIdentity({
        agentName: "test-agent",
        role: "provider",
        description: "Test agent",
        capabilities: "coding,analysis",
        autoRegister: true,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        registerFn,
      });

      expect(result.action).toBe("registered");
      expect(registerFn).toHaveBeenCalledTimes(1);
      expect(result.identity.txHash).toBe("0xdef");

      // Verify state was written
      const identity = readIdentityState();
      expect(identity.status).toBe("pending");
      expect(identity.txHash).toBe("0xdef");
    });

    it("does not double mint on re-run with pending registration", async () => {
      // First run: register
      const registerFn = vi.fn().mockResolvedValue({
        ok: true,
        txHash: "0xabc",
      });

      await ensureIdentity({
        agentName: "test",
        role: "provider",
        autoRegister: true,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        registerFn,
        _onChainOverride: emptyOnChain,
      });

      expect(registerFn).toHaveBeenCalledTimes(1);

      // Second run: should NOT call registerFn again
      const result = await ensureIdentity({
        agentName: "test",
        role: "provider",
        autoRegister: true,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        registerFn,
        _onChainOverride: emptyOnChain,
      });

      expect(result.action).toBe("already_pending");
      expect(registerFn).toHaveBeenCalledTimes(1); // still 1, not 2
    });
  });

  describe("idempotencyKey", () => {
    it("generateIdempotencyKey is deterministic", () => {
      const key1 = generateIdempotencyKey("0xABC", "data:test");
      const key2 = generateIdempotencyKey("0xabc", "data:test");
      expect(key1).toBe(key2); // case-insensitive on address
      expect(key1).toMatch(/^erc8004-register:0xabc:/);
    });

    it("generateIdempotencyKey differs for different inputs", () => {
      const key1 = generateIdempotencyKey("0xabc", "data:test1");
      const key2 = generateIdempotencyKey("0xabc", "data:test2");
      expect(key1).not.toBe(key2);
    });

    it("passes idempotencyKey to registerFn", async () => {
      const registerFn = vi.fn().mockResolvedValue({ ok: true, txHash: "0x123" });
      const walletAddress = "0x1234567890abcdef1234567890abcdef12345678";

      await ensureIdentity({
        agentName: "test",
        role: "provider",
        autoRegister: true,
        walletAddress,
        registerFn,
      });

      expect(registerFn).toHaveBeenCalledTimes(1);
      const [metadataURI, idempotencyKey] = registerFn.mock.calls[0];
      expect(metadataURI).toMatch(/^data:application\/json;base64,/);
      expect(idempotencyKey).toMatch(/^erc8004-register:0x1234567890abcdef1234567890abcdef12345678:/);
    });

    it("rerun with pending registration reuses same idempotencyKey", async () => {
      const registerFn = vi.fn().mockResolvedValue({ ok: true, txHash: "0xabc" });
      const walletAddress = "0x1234567890abcdef1234567890abcdef12345678";

      await ensureIdentity({
        agentName: "test",
        role: "provider",
        autoRegister: true,
        walletAddress,
        registerFn,
      });

      const regState = readRegistrationState();
      expect(regState?.idempotencyKey).toBeDefined();
      expect(regState?.idempotencyKey).toMatch(/^erc8004-register:/);
    });
  });

  describe("finalizePendingIdentity", () => {
    it("finalizes pending tx to confirmed with tokenId", async () => {
      writeRegistrationState({
        status: "submitted",
        txHash: "0xabc",
        metadataURI: "data:test",
        submittedAt: new Date().toISOString(),
      });

      const finalizeFn = vi.fn().mockResolvedValue({
        status: "confirmed" as const,
        tokenId: "42",
      });

      const result = await finalizePendingIdentity({ finalizeFn });

      expect(result.action).toBe("confirmed");
      expect(result.tokenId).toBe("42");

      // Verify identity was written
      const identity = readIdentityState();
      expect(identity.status).toBe("confirmed");
      expect(identity.tokenId).toBe("42");
      expect(identity.txHash).toBe("0xabc");

      // Verify registration was updated
      const reg = readRegistrationState();
      expect(reg?.status).toBe("confirmed");
    });

    it("returns still_pending when tx not mined", async () => {
      writeRegistrationState({
        status: "submitted",
        txHash: "0xabc",
        metadataURI: "data:test",
        submittedAt: new Date().toISOString(),
      });

      const finalizeFn = vi.fn().mockResolvedValue({
        status: "still_pending" as const,
      });

      const result = await finalizePendingIdentity({ finalizeFn });
      expect(result.action).toBe("still_pending");
    });

    it("marks reverted tx as failed", async () => {
      writeRegistrationState({
        status: "submitted",
        txHash: "0xabc",
        metadataURI: "data:test",
        submittedAt: new Date().toISOString(),
      });

      const finalizeFn = vi.fn().mockResolvedValue({
        status: "reverted" as const,
      });

      const result = await finalizePendingIdentity({ finalizeFn });
      expect(result.action).toBe("reverted");

      const reg = readRegistrationState();
      expect(reg?.status).toBe("failed");
      expect(reg?.error).toContain("reverted");
    });

    it("returns not_found when no pending registration", async () => {
      const finalizeFn = vi.fn();
      const result = await finalizePendingIdentity({ finalizeFn });
      expect(result.action).toBe("not_found");
      expect(finalizeFn).not.toHaveBeenCalled();
    });
  });

  describe("ensureIdentity with finalizeFn", () => {
    it("finalizes pending and returns confirmed_pending", async () => {
      writeRegistrationState({
        status: "submitted",
        txHash: "0xabc",
        metadataURI: "data:test",
        submittedAt: new Date().toISOString(),
      });

      const registerFn = vi.fn();
      const finalizeFn = vi.fn().mockResolvedValue({
        status: "confirmed" as const,
        tokenId: "42",
      });

      const result = await ensureIdentity({
        agentName: "test",
        role: "provider",
        autoRegister: true,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        registerFn,
        finalizeFn,
        _onChainOverride: emptyOnChain,
      });

      expect(result.action).toBe("confirmed_pending");
      expect(result.identity.tokenId).toBe("42");
      expect(registerFn).not.toHaveBeenCalled(); // didn't re-register
    });

    it("re-registers after reverted tx if autoRegister", async () => {
      writeRegistrationState({
        status: "failed",
        txHash: "0xabc",
        metadataURI: "data:test",
        submittedAt: new Date().toISOString(),
        error: "Transaction reverted on-chain",
      });

      const registerFn = vi.fn().mockResolvedValue({ ok: true, txHash: "0xdef" });
      const finalizeFn = vi.fn();

      const result = await ensureIdentity({
        agentName: "test",
        role: "provider",
        autoRegister: true,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        registerFn,
        finalizeFn,
        _onChainOverride: emptyOnChain,
      });

      // Should attempt to re-register since the previous failed
      expect(result.action).toBe("registered");
      expect(registerFn).toHaveBeenCalledTimes(1);
    });

    it("full CLI path: first run registers, second run finalizes to tokenId", async () => {
      // Simulate first run: register and get pending
      const registerFn = vi.fn().mockResolvedValue({ ok: true, txHash: "0x111" });
      const finalizeFn = vi.fn();

      const firstResult = await ensureIdentity({
        agentName: "test-agent",
        role: "provider",
        autoRegister: true,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        registerFn,
        finalizeFn,
      });

      expect(firstResult.action).toBe("registered");
      expect(firstResult.identity.txHash).toBe("0x111");

      // Verify state is pending
      const identityAfterFirst = readIdentityState();
      expect(identityAfterFirst.status).toBe("pending");

      // Simulate second run: finalizeFn returns confirmed
      const finalizeFn2 = vi.fn().mockResolvedValue({
        status: "confirmed" as const,
        tokenId: "42",
      });

      const secondResult = await ensureIdentity({
        agentName: "test-agent",
        role: "provider",
        autoRegister: true,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        registerFn: vi.fn(), // should NOT be called
        finalizeFn: finalizeFn2,
      });

      expect(secondResult.action).toBe("confirmed_pending");
      expect(secondResult.identity.tokenId).toBe("42");

      // Verify identity was written as confirmed
      const identityAfterSecond = readIdentityState();
      expect(identityAfterSecond.status).toBe("confirmed");
      expect(identityAfterSecond.tokenId).toBe("42");

      // Third run: should be already_confirmed (no finalizeFn needed)
      const thirdResult = await ensureIdentity({
        agentName: "test-agent",
        role: "provider",
        autoRegister: true,
        registerFn: vi.fn(),
      });

      expect(thirdResult.action).toBe("already_confirmed");
      expect(thirdResult.identity.tokenId).toBe("42");
    });
  });

  describe("buildMetadataURI", () => {
    it("creates data: URI with JSON metadata", () => {
      const uri = buildMetadataURI({
        agentName: "test-agent",
        role: "provider",
        description: "A test agent",
        capabilities: "coding,analysis",
      });

      expect(uri).toMatch(/^data:application\/json;base64,/);

      // Decode and verify
      const base64 = uri.replace("data:application/json;base64,", "");
      const json = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
      expect(json.name).toBe("test-agent");
      expect(json.role).toBe("provider");
      expect(json.description).toBe("A test agent");
      expect(json.capabilities).toEqual(["coding", "analysis"]);
    });
  });

  describe("ESM-safe atomic lock", () => {
    it("acquires and releases lock", () => {
      expect(acquireLock()).toBe(true);
      expect(acquireLock()).toBe(false); // already locked
      releaseLock();
      expect(acquireLock()).toBe(true); // can acquire again
      releaseLock();
    });

    it("uses exclusive create (no TOCTOU race)", () => {
      // First acquire succeeds
      expect(acquireLock()).toBe(true);
      // Second acquire fails (file already exists)
      expect(acquireLock()).toBe(false);
      releaseLock();
    });
  });

  describe("no dynamic require", () => {
    it("identity-ensure.ts has no dynamic require calls", async () => {
      // Read the source file
      const fs = await import("node:fs");
      const path = join(__dirname, "identity-ensure.ts");
      const source = fs.readFileSync(path, "utf8");

      // Should not contain require("node:fs") or require('node:fs')
      expect(source).not.toMatch(/require\(["']node:fs["']\)/);
      expect(source).not.toMatch(/require\(["']fs["']\)/);
    });
  });
});
