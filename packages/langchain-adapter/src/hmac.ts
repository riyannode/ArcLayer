/**
 * @arclayer/langchain-adapter — HMAC request signing.
 *
 * Signs HTTP requests compatible with Runner's assertHmacAuthenticated().
 * Payload format: METHOD\nPATH_WITH_QUERY\nTIMESTAMP\nNONCE\nBODY_SHA256
 *
 * Reuses crypto primitives from @arclayer/runner-core where possible,
 * but implements signing standalone so the adapter has zero internal imports.
 */

import { createHmac, createHash, randomBytes } from "node:crypto";

// ── Payload Construction ────────────────────────────────────────────────────

/**
 * Build the HMAC signature payload string.
 * Exact format expected by Runner: METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_HASH
 */
export function buildHmacPayload(
  method: string,
  pathWithQuery: string,
  timestamp: string,
  nonce: string,
  bodyHash: string,
): string {
  return `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

/**
 * SHA-256 hex digest of a string (UTF-8).
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * HMAC-SHA256 hex digest.
 */
export function hmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * Generate a random nonce (16 bytes → 32 hex chars).
 */
export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Generate an ISO 8601 timestamp.
 */
export function generateTimestamp(): string {
  return new Date().toISOString();
}

// ── Header Names ────────────────────────────────────────────────────────────

export const HMAC_TIMESTAMP_HEADER = "x-arclayer-runner-timestamp";
export const HMAC_NONCE_HEADER = "x-arclayer-runner-nonce";
export const HMAC_SIGNATURE_HEADER = "x-arclayer-runner-signature";

// ── Signing ─────────────────────────────────────────────────────────────────

export type SignedHeaders = {
  [HMAC_TIMESTAMP_HEADER]: string;
  [HMAC_NONCE_HEADER]: string;
  [HMAC_SIGNATURE_HEADER]: string;
  "content-type": string;
};

/**
 * Sign an HTTP request for Runner HMAC auth.
 *
 * @param secret - Runner HMAC secret
 * @param method - HTTP method (GET, POST, etc.)
 * @param pathWithQuery - Request path including query string (e.g. "/ledger?limit=50")
 * @param body - Raw body string (empty string for GET)
 * @returns Headers to attach to the request
 */
export function signRequest(
  secret: string,
  method: string,
  pathWithQuery: string,
  body: string,
): SignedHeaders {
  if (!secret) {
    throw new Error("runnerSecret must not be empty");
  }

  const timestamp = generateTimestamp();
  const nonce = generateNonce();
  const bodyHash = sha256Hex(body);
  const payload = buildHmacPayload(
    method.toUpperCase(),
    pathWithQuery,
    timestamp,
    nonce,
    bodyHash,
  );
  const signature = `sha256=${hmacSha256(secret, payload)}`;

  return {
    [HMAC_TIMESTAMP_HEADER]: timestamp,
    [HMAC_NONCE_HEADER]: nonce,
    [HMAC_SIGNATURE_HEADER]: signature,
    "content-type": "application/json",
  };
}
