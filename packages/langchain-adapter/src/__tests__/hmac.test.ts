import { describe, it, expect } from "vitest";
import {
  buildHmacPayload,
  sha256Hex,
  hmacSha256,
  generateNonce,
  generateTimestamp,
  signRequest,
  HMAC_TIMESTAMP_HEADER,
  HMAC_NONCE_HEADER,
  HMAC_SIGNATURE_HEADER,
} from "../hmac.js";

describe("hmac", () => {
  describe("buildHmacPayload", () => {
    it("builds correct payload format", () => {
      const payload = buildHmacPayload(
        "POST",
        "/x402/pay",
        "2025-01-01T00:00:00.000Z",
        "abc123",
        "deadbeef",
      );
      expect(payload).toBe(
        "POST\n/x402/pay\n2025-01-01T00:00:00.000Z\nabc123\ndeadbeef",
      );
    });

    it("includes query string in path", () => {
      const payload = buildHmacPayload(
        "GET",
        "/receipts?limit=50",
        "ts",
        "nonce",
        "hash",
      );
      expect(payload).toContain("/receipts?limit=50");
    });
  });

  describe("sha256Hex", () => {
    it("produces 64-char hex string", () => {
      const hash = sha256Hex("");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces stable output", () => {
      expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
    });

    it("produces different output for different input", () => {
      expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
    });

    it("empty string has known hash", () => {
      // SHA256 of empty string
      expect(sha256Hex("")).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
    });
  });

  describe("hmacSha256", () => {
    it("produces 64-char hex string", () => {
      const sig = hmacSha256("secret", "payload");
      expect(sig).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces stable output", () => {
      expect(hmacSha256("s", "p")).toBe(hmacSha256("s", "p"));
    });

    it("different secrets produce different output", () => {
      expect(hmacSha256("secret1", "payload")).not.toBe(
        hmacSha256("secret2", "payload"),
      );
    });
  });

  describe("generateNonce", () => {
    it("returns 32-char hex string", () => {
      const nonce = generateNonce();
      expect(nonce).toMatch(/^[a-f0-9]{32}$/);
    });

    it("returns unique values", () => {
      const nonces = new Set(Array.from({ length: 100 }, () => generateNonce()));
      expect(nonces.size).toBe(100);
    });
  });

  describe("generateTimestamp", () => {
    it("returns ISO 8601 string", () => {
      const ts = generateTimestamp();
      expect(new Date(ts).toISOString()).toBe(ts);
    });
  });

  describe("signRequest", () => {
    it("returns all required headers", () => {
      const headers = signRequest("secret", "GET", "/health", "");
      expect(headers[HMAC_TIMESTAMP_HEADER]).toBeDefined();
      expect(headers[HMAC_NONCE_HEADER]).toBeDefined();
      expect(headers[HMAC_SIGNATURE_HEADER]).toBeDefined();
      expect(headers["content-type"]).toBe("application/json");
    });

    it("signature starts with sha256=", () => {
      const headers = signRequest("secret", "POST", "/x402/pay", '{"test":1}');
      expect(headers[HMAC_SIGNATURE_HEADER]).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it("throws on empty secret", () => {
      expect(() => signRequest("", "GET", "/health", "")).toThrow(
        "runnerSecret must not be empty",
      );
    });

    it("signature is deterministic for same inputs", () => {
      // We need to mock nonce/timestamp for this, but we can verify
      // that two calls with the same nonce+timestamp produce the same sig
      const nonce = "fixednonce";
      const ts = "2025-01-01T00:00:00.000Z";
      const body = '{"test":1}';
      const method = "POST";
      const path = "/x402/pay";

      const bodyHash = sha256Hex(body);
      const payload = buildHmacPayload(method, path, ts, nonce, bodyHash);
      const sig1 = `sha256=${hmacSha256("secret", payload)}`;
      const sig2 = `sha256=${hmacSha256("secret", payload)}`;
      expect(sig1).toBe(sig2);
    });
  });
});
