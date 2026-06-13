import type { IncomingMessage } from "node:http";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { RunnerError } from "./errors";

// ── HMAC Auth Constants ─────────────────────────────────────────────────────

export const HMAC_TIMESTAMP_HEADER = "x-arclayer-runner-timestamp";
export const HMAC_NONCE_HEADER = "x-arclayer-runner-nonce";
export const HMAC_SIGNATURE_HEADER = "x-arclayer-runner-signature";

/** Default timestamp skew tolerance: 5 minutes */
export const DEFAULT_HMAC_SKEW_MS = 300_000;

// ── Bearer Auth (legacy, kept for STDIO fallback) ───────────────────────────

/**
 * Extract Bearer token from Authorization header.
 * Returns undefined if header missing or not Bearer format.
 */
export function extractBearerToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (!auth) return undefined;
  // Case-insensitive prefix check + slice. No regex.
  const lower = auth.toLowerCase();
  if (!lower.startsWith("bearer ")) return undefined;
  const token = auth.slice(7).trim();
  return token || undefined;
}

/**
 * Assert that the request has a valid Bearer token matching the runner secret.
 * Throws RunnerError(401) if missing or invalid.
 * @deprecated Use assertHmacAuthenticated for production HTTP routes.
 */
export function assertAuthenticated(req: IncomingMessage, secret: string): void {
  const token = extractBearerToken(req);
  if (!token) {
    throw new RunnerError(
      "AUTH_MISSING",
      "Missing Authorization: Bearer *** header",
      401
    );
  }
  if (token !== secret) {
    throw new RunnerError(
      "AUTH_INVALID",
      "Invalid runner secret",
      401
    );
  }
}

// ── HMAC Auth (production) ──────────────────────────────────────────────────

/**
 * Build the HMAC signature payload string.
 * METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_HASH
 */
export function buildHmacPayload(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyHash: string
): string {
  return `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

/**
 * Compute SHA-256 hex digest of a buffer.
 */
export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Compute HMAC-SHA256 hex digest.
 */
export function hmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Parse HMAC headers from request. Returns null if any required header is missing.
 */
export function extractHmacHeaders(req: IncomingMessage): {
  timestamp: string;
  nonce: string;
  signature: string;
} | null {
  const timestamp = req.headers[HMAC_TIMESTAMP_HEADER.toLowerCase()] as string | undefined;
  const nonce = req.headers[HMAC_NONCE_HEADER.toLowerCase()] as string | undefined;
  const signature = req.headers[HMAC_SIGNATURE_HEADER.toLowerCase()] as string | undefined;

  if (!timestamp || !nonce || !signature) return null;
  return { timestamp, nonce, signature };
}

/**
 * Validate timestamp is within skew tolerance.
 * Returns parsed timestamp Date.
 * Throws RunnerError(401) if invalid or expired.
 */
export function validateTimestamp(timestamp: string, skewMs: number = DEFAULT_HMAC_SKEW_MS): Date {
  const ts = new Date(timestamp);
  if (isNaN(ts.getTime())) {
    throw new RunnerError("AUTH_INVALID_TIMESTAMP", "Invalid timestamp format", 401);
  }

  const now = Date.now();
  const diff = Math.abs(now - ts.getTime());
  if (diff > skewMs) {
    throw new RunnerError(
      "AUTH_TIMESTAMP_EXPIRED",
      `Timestamp expired: ${diff}ms old (max ${skewMs}ms)`,
      401
    );
  }

  return ts;
}

/**
 * Verify HMAC signature using timing-safe comparison.
 * Throws RunnerError(401) if signature is invalid.
 */
export function verifyHmacSignature(
  secret: string,
  payload: string,
  receivedSignature: string
): void {
  // receivedSignature format: sha256=<hex>
  const expectedHex = hmacSha256(secret, payload);
  const expected = `sha256=${expectedHex}`;

  // Timing-safe comparison
  if (expected.length !== receivedSignature.length) {
    throw new RunnerError("AUTH_INVALID_SIGNATURE", "Invalid HMAC signature", 401);
  }

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(receivedSignature, "utf8");

  if (!timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new RunnerError("AUTH_INVALID_SIGNATURE", "Invalid HMAC signature", 401);
  }
}

/**
 * Assert that the request has a valid HMAC signature.
 *
 * Verification order:
 * 1. Extract required HMAC headers
 * 2. Validate timestamp parse and skew
 * 3. Caller must check nonce replay BEFORE calling this (nonce store)
 * 4. Compute SHA256(rawBody)
 * 5. Build payload string
 * 6. Verify HMAC signature with timingSafeEqual
 *
 * @param req - Incoming HTTP request
 * @param secret - Runner HMAC secret
 * @param rawBody - Raw request body as Buffer (must be read BEFORE JSON parse)
 * @param pathname - Request pathname (for payload)
 * @param skewMs - Timestamp skew tolerance in ms
 */
export function assertHmacAuthenticated(
  req: IncomingMessage,
  secret: string,
  rawBody: Buffer,
  pathname: string,
  skewMs: number = DEFAULT_HMAC_SKEW_MS
): { timestamp: string; nonce: string } {
  // 1. Extract headers
  const headers = extractHmacHeaders(req);
  if (!headers) {
    throw new RunnerError(
      "AUTH_MISSING_HMAC",
      "Missing HMAC headers: x-arclayer-runner-timestamp, x-arclayer-runner-nonce, x-arclayer-runner-signature",
      401
    );
  }

  // 2. Validate timestamp
  validateTimestamp(headers.timestamp, skewMs);

  // 3. Nonce check is done by caller (needs NonceStore)
  // We return nonce for caller to check/store

  // 4. Compute body hash
  const bodyHash = sha256Buffer(rawBody);

  // 5. Build payload
  const method = (req.method || "GET").toUpperCase();
  const payload = buildHmacPayload(method, pathname, headers.timestamp, headers.nonce, bodyHash);

  // 6. Verify signature
  verifyHmacSignature(secret, payload, headers.signature);

  return { timestamp: headers.timestamp, nonce: headers.nonce };
}

// ── Public Routes ───────────────────────────────────────────────────────────

/**
 * Public routes that do NOT require auth.
 * DEFAULT-DENY: every route not in this set requires authentication.
 */
export const PUBLIC_ROUTES = new Set([
  "/health",
  "/.well-known/arclayer-agent.json",
  "/skills/arclayer-global"
]);

/**
 * Check if a route path is public (no auth required).
 * Default-deny: unknown routes require auth.
 */
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.has(pathname);
}
