/**
 * Identity ensure tests.
 *
 * Verifies:
 *   - Skips mint when identity exists (confirmed)
 *   - Does not double mint after submitted tx state
 *   - Creates identity when missing and auto-register is set
 *   - Rejects when auto-register is not set
 *   - Lock prevents concurrent registration
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
        registerFn,
      });

      expect(registerFn).toHaveBeenCalledTimes(1);

      // Second run: should NOT call registerFn again
      const result = await ensureIdentity({
        agentName: "test",
        role: "provider",
        autoRegister: true,
        registerFn,
      });

      expect(result.action).toBe("already_pending");
      expect(registerFn).toHaveBeenCalledTimes(1); // still 1, not 2
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

  describe("lock management", () => {
    it("acquires and releases lock", () => {
      expect(acquireLock()).toBe(true);
      expect(acquireLock()).toBe(false); // already locked
      releaseLock();
      expect(acquireLock()).toBe(true); // can acquire again
      releaseLock();
    });
  });
});
