import { describe, it, expect } from "vitest";
import {
  buildHmacPayload,
  sha256Buffer,
  hmacSha256,
  extractHmacHeaders,
  validateTimestamp,
  verifyHmacSignature,
  assertHmacAuthenticated,
  HMAC_TIMESTAMP_HEADER,
  HMAC_NONCE_HEADER,
  HMAC_SIGNATURE_HEADER,
  DEFAULT_HMAC_SKEW_MS
} from "./auth";
import { RunnerError } from "./errors";
import type { IncomingMessage } from "node:http";
import { createHmac } from "node:crypto";

function makeHmacReq(opts: {
  method?: string;
  path?: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
  authHeader?: string;
} = {}): IncomingMessage {
  const headers: Record<string, string | string[] | undefined> = {};
  if (opts.timestamp) headers[HMAC_TIMESTAMP_HEADER.toLowerCase()] = opts.timestamp;
  if (opts.nonce) headers[HMAC_NONCE_HEADER.toLowerCase()] = opts.nonce;
  if (opts.signature) headers[HMAC_SIGNATURE_HEADER.toLowerCase()] = opts.signature;
  if (opts.authHeader) headers.authorization = opts.authHeader;
  return {
    headers,
    method: opts.method || "POST"
  } as unknown as IncomingMessage;
}

function expectRunnerError(fn: () => void, code: string) {
  try {
    fn();
    expect.fail(`Expected RunnerError with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RunnerError);
    expect((error as RunnerError).code).toBe(code);
  }
}

function computeValidSignature(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyHash: string
): string {
  const payload = buildHmacPayload(method, path, timestamp, nonce, bodyHash);
  const hex = hmacSha256(secret, payload);
  return `sha256=${hex}`;
}

describe("buildHmacPayload", () => {
  it("builds correct payload string", () => {
    const payload = buildHmacPayload("POST", "/run", "2026-01-01T00:00:00Z", "abc123", "deadbeef");
    expect(payload).toBe("POST\n/run\n2026-01-01T00:00:00Z\nabc123\ndeadbeef");
  });

  it("includes all components separated by newlines", () => {
    const payload = buildHmacPayload("GET", "/health", "ts", "n", "h");
    const parts = payload.split("\n");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("GET");
    expect(parts[1]).toBe("/health");
    expect(parts[2]).toBe("ts");
    expect(parts[3]).toBe("n");
    expect(parts[4]).toBe("h");
  });
});

describe("sha256Buffer", () => {
  it("returns 64-char hex string", () => {
    const hash = sha256Buffer(Buffer.from("hello"));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns consistent hash for same input", () => {
    const a = sha256Buffer(Buffer.from("test data"));
    const b = sha256Buffer(Buffer.from("test data"));
    expect(a).toBe(b);
  });

  it("returns different hash for different input", () => {
    const a = sha256Buffer(Buffer.from("hello"));
    const b = sha256Buffer(Buffer.from("world"));
    expect(a).not.toBe(b);
  });

  it("handles empty buffer", () => {
    const hash = sha256Buffer(Buffer.alloc(0));
    expect(hash).toHaveLength(64);
  });
});

describe("hmacSha256", () => {
  it("returns 64-char hex string", () => {
    const hmac = hmacSha256("secret", "payload");
    expect(hmac).toHaveLength(64);
    expect(hmac).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces same HMAC for same inputs", () => {
    const a = hmacSha256("key", "message");
    const b = hmacSha256("key", "message");
    expect(a).toBe(b);
  });

  it("produces different HMAC for different keys", () => {
    const a = hmacSha256("key1", "message");
    const b = hmacSha256("key2", "message");
    expect(a).not.toBe(b);
  });

  it("matches Node.js createHmac output", () => {
    const expected = createHmac("sha256", "mykey").update("mymsg").digest("hex");
    const actual = hmacSha256("mykey", "mymsg");
    expect(actual).toBe(expected);
  });
});

describe("extractHmacHeaders", () => {
  it("extracts all three headers", () => {
    const req = makeHmacReq({ timestamp: "ts", nonce: "n", signature: "sig" });
    const result = extractHmacHeaders(req);
    expect(result).toEqual({ timestamp: "ts", nonce: "n", signature: "sig" });
  });

  it("returns null if timestamp missing", () => {
    const req = makeHmacReq({ nonce: "n", signature: "sig" });
    expect(extractHmacHeaders(req)).toBeNull();
  });

  it("returns null if nonce missing", () => {
    const req = makeHmacReq({ timestamp: "ts", signature: "sig" });
    expect(extractHmacHeaders(req)).toBeNull();
  });

  it("returns null if signature missing", () => {
    const req = makeHmacReq({ timestamp: "ts", nonce: "n" });
    expect(extractHmacHeaders(req)).toBeNull();
  });

  it("returns null if all missing", () => {
    const req = makeHmacReq();
    expect(extractHmacHeaders(req)).toBeNull();
  });
});

describe("validateTimestamp", () => {
  it("accepts current timestamp", () => {
    const now = new Date().toISOString();
    expect(() => validateTimestamp(now)).not.toThrow();
  });

  it("accepts timestamp within skew", () => {
    const recent = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    expect(() => validateTimestamp(recent, DEFAULT_HMAC_SKEW_MS)).not.toThrow();
  });

  it("rejects timestamp outside skew", () => {
    const old = new Date(Date.now() - 600_000).toISOString(); // 10 min ago
    expectRunnerError(() => validateTimestamp(old, DEFAULT_HMAC_SKEW_MS), "AUTH_TIMESTAMP_EXPIRED");
  });

  it("rejects future timestamp outside skew", () => {
    const future = new Date(Date.now() + 600_000).toISOString(); // 10 min future
    expectRunnerError(() => validateTimestamp(future, DEFAULT_HMAC_SKEW_MS), "AUTH_TIMESTAMP_EXPIRED");
  });

  it("rejects invalid timestamp format", () => {
    expectRunnerError(() => validateTimestamp("not-a-date"), "AUTH_INVALID_TIMESTAMP");
  });

  it("returns parsed Date", () => {
    const ts = new Date().toISOString();
    const result = validateTimestamp(ts);
    expect(result).toBeInstanceOf(Date);
  });
});

describe("verifyHmacSignature", () => {
  const secret = "test-secret-16chars!";

  it("passes with valid signature", () => {
    const payload = buildHmacPayload("POST", "/run", "ts", "nonce", "hash");
    const sig = `sha256=${hmacSha256(secret, payload)}`;
    expect(() => verifyHmacSignature(secret, payload, sig)).not.toThrow();
  });

  it("throws AUTH_INVALID_SIGNATURE for wrong signature", () => {
    expectRunnerError(
      () => verifyHmacSignature(secret, "payload", "sha256=0000"),
      "AUTH_INVALID_SIGNATURE"
    );
  });

  it("throws AUTH_INVALID_SIGNATURE for missing sha256= prefix", () => {
    const payload = "test";
    const sig = hmacSha256(secret, payload); // no prefix
    expectRunnerError(
      () => verifyHmacSignature(secret, payload, sig),
      "AUTH_INVALID_SIGNATURE"
    );
  });

  it("throws AUTH_INVALID_SIGNATURE for wrong secret", () => {
    const payload = buildHmacPayload("POST", "/run", "ts", "nonce", "hash");
    const sig = `sha256=${hmacSha256("wrong-secret", payload)}`;
    expectRunnerError(
      () => verifyHmacSignature(secret, payload, sig),
      "AUTH_INVALID_SIGNATURE"
    );
  });
});

describe("assertHmacAuthenticated", () => {
  const secret = "test-secret-16chars!";

  it("passes with valid HMAC headers and body", () => {
    const body = Buffer.from('{"test":true}');
    const bodyHash = sha256Buffer(body);
    const now = new Date().toISOString();
    const nonce = "random-nonce-123";
    const sig = computeValidSignature(secret, "POST", "/run", now, nonce, bodyHash);

    const req = makeHmacReq({
      method: "POST",
      path: "/run",
      timestamp: now,
      nonce,
      signature: sig
    });

    const result = assertHmacAuthenticated(req, secret, body, "/run");
    expect(result.timestamp).toBe(now);
    expect(result.nonce).toBe(nonce);
  });

  it("throws AUTH_MISSING_HMAC if headers missing", () => {
    const req = makeHmacReq();
    const body = Buffer.alloc(0);
    expectRunnerError(
      () => assertHmacAuthenticated(req, secret, body, "/run"),
      "AUTH_MISSING_HMAC"
    );
  });

  it("throws AUTH_TIMESTAMP_EXPIRED for old timestamp", () => {
    const body = Buffer.alloc(0);
    const bodyHash = sha256Buffer(body);
    const old = new Date(Date.now() - 600_000).toISOString();
    const nonce = "nonce";
    const sig = computeValidSignature(secret, "POST", "/run", old, nonce, bodyHash);

    const req = makeHmacReq({ method: "POST", path: "/run", timestamp: old, nonce, signature: sig });
    expectRunnerError(
      () => assertHmacAuthenticated(req, secret, body, "/run"),
      "AUTH_TIMESTAMP_EXPIRED"
    );
  });

  it("throws AUTH_INVALID_SIGNATURE for tampered body", () => {
    const originalBody = Buffer.from('{"test":true}');
    const tamperedBody = Buffer.from('{"test":false}');
    const bodyHash = sha256Buffer(originalBody); // sign with original
    const now = new Date().toISOString();
    const nonce = "nonce";
    const sig = computeValidSignature(secret, "POST", "/run", now, nonce, bodyHash);

    const req = makeHmacReq({ method: "POST", path: "/run", timestamp: now, nonce, signature: sig });
    expectRunnerError(
      () => assertHmacAuthenticated(req, secret, tamperedBody, "/run"),
      "AUTH_INVALID_SIGNATURE"
    );
  });

  it("throws AUTH_INVALID_SIGNATURE for wrong path", () => {
    const body = Buffer.alloc(0);
    const bodyHash = sha256Buffer(body);
    const now = new Date().toISOString();
    const nonce = "nonce";
    // Sign for /run but request comes to /x402/pay
    const sig = computeValidSignature(secret, "POST", "/run", now, nonce, bodyHash);

    const req = makeHmacReq({ method: "POST", path: "/run", timestamp: now, nonce, signature: sig });
    expectRunnerError(
      () => assertHmacAuthenticated(req, secret, body, "/x402/pay"),
      "AUTH_INVALID_SIGNATURE"
    );
  });
});
