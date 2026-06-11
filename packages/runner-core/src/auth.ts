import type { IncomingMessage } from "node:http";
import { RunnerError } from "./errors";

/**
 * Extract Bearer token from Authorization header.
 * Returns undefined if header missing or not Bearer format.
 */
export function extractBearerToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (!auth) return undefined;
  // Avoid regex to prevent CodeQL polynomial backtracking alert.
  // Case-insensitive prefix check + slice.
  const lower = auth.toLowerCase();
  if (!lower.startsWith("bearer ")) return undefined;
  const token = auth.slice(7).trim();
  return token || undefined;
}

/**
 * Assert that the request has a valid Bearer token matching the runner secret.
 * Throws RunnerError(401) if missing or invalid.
 */
export function assertAuthenticated(req: IncomingMessage, secret: string): void {
  const token = extractBearerToken(req);
  if (!token) {
    throw new RunnerError(
      "AUTH_MISSING",
      "Missing Authorization: Bearer <secret> header",
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

/**
 * Route path sets that require authentication.
 */
export const PROTECTED_ROUTES = new Set([
  "/runtime/run",
  "/erc8004/prepare-register",
  "/erc8183/provider/run",
  "/x402/inspect",
  "/x402/pay",
  "/x402/batch-pay",
  "/circle/status",
  "/receipts",
  "/ledger"
]);

/**
 * Route path sets that are public (no auth required).
 */
export const PUBLIC_ROUTES = new Set([
  "/health",
  "/.well-known/arclayer-agent.json",
  "/skills/arclayer-global"
]);

/**
 * Check if a route path requires authentication.
 */
export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.has(pathname);
}
