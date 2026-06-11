import type { IncomingMessage } from "node:http";
import { RunnerError } from "./errors";

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
