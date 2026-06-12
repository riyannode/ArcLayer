import { describe, it, expect } from "vitest";
import { extractBearerToken, assertAuthenticated, isPublicRoute } from "./auth";
import { RunnerError } from "./errors";
import type { IncomingMessage } from "node:http";

function makeReq(authHeader?: string): IncomingMessage {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return { headers } as unknown as IncomingMessage;
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

describe("extractBearerToken", () => {
  it("extracts valid bearer token", () => {
    expect(extractBearerToken(makeReq("Bearer my-secret-token"))).toBe("my-secret-token");
  });

  it("returns undefined for missing header", () => {
    expect(extractBearerToken(makeReq())).toBeUndefined();
  });

  it("returns undefined for non-bearer auth", () => {
    expect(extractBearerToken(makeReq("Basic abc123"))).toBeUndefined();
  });

  it("handles case-insensitive Bearer", () => {
    expect(extractBearerToken(makeReq("bearer my-token"))).toBe("my-token");
  });

  it("returns undefined for empty token", () => {
    expect(extractBearerToken(makeReq("Bearer "))).toBeUndefined();
    expect(extractBearerToken(makeReq("Bearer   "))).toBeUndefined();
  });
});

describe("assertAuthenticated", () => {
  const secret = "test-secret-16chars!";

  it("passes with valid token", () => {
    expect(() => assertAuthenticated(makeReq(`Bearer ${secret}`), secret)).not.toThrow();
  });

  it("throws AUTH_MISSING for missing auth", () => {
    expectRunnerError(() => assertAuthenticated(makeReq(), secret), "AUTH_MISSING");
  });

  it("throws AUTH_INVALID for invalid token", () => {
    expectRunnerError(() => assertAuthenticated(makeReq("Bearer wrong-token"), secret), "AUTH_INVALID");
  });
});

describe("isPublicRoute (default-deny)", () => {
  it("marks /health as public", () => {
    expect(isPublicRoute("/health")).toBe(true);
  });

  it("marks /.well-known/arclayer-agent.json as public", () => {
    expect(isPublicRoute("/.well-known/arclayer-agent.json")).toBe(true);
  });

  it("marks /skills/arclayer-global as public", () => {
    expect(isPublicRoute("/skills/arclayer-global")).toBe(true);
  });

  it("marks /x402/pay as NOT public (default-deny)", () => {
    expect(isPublicRoute("/x402/pay")).toBe(false);
  });

  it("marks /runtime/run as NOT public (default-deny)", () => {
    expect(isPublicRoute("/runtime/run")).toBe(false);
  });

  it("marks unknown routes as NOT public (default-deny)", () => {
    expect(isPublicRoute("/unknown")).toBe(false);
    expect(isPublicRoute("/new-future-route")).toBe(false);
    expect(isPublicRoute("/")).toBe(false);
  });
});
