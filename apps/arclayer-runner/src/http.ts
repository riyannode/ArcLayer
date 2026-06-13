import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  asRunnerError,
  RunnerError,
  assertHmacAuthenticated,
  assertAuthenticated,
  isPublicRoute,
  NonceStore,
  TaskIdempotencyStore,
  sha256Buffer
} from "@arclayer/runner-core";

export type HandlerContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: unknown;
  /** Raw body buffer — available for proof/audit */
  rawBody: Buffer;
};

export type RouteHandler = (ctx: HandlerContext) => Promise<unknown>;

/**
 * Raw handler for routes that need direct req/res access (e.g. JSON-RPC MCP).
 * If rawHandler is set, the standard body reading and JSON response are skipped.
 */
export type RawRouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

type Route = {
  method: string;
  path: string;
  handler?: RouteHandler;
  rawHandler?: RawRouteHandler;
};

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

/**
 * Read raw body as Buffer. Does NOT parse JSON.
 * Throws RunnerError(413) if body exceeds MAX_BODY_BYTES.
 */
async function readRawBody(req: IncomingMessage, method: string): Promise<Buffer> {
  if (method === "GET" || method === "HEAD") return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new RunnerError("BODY_TOO_LARGE", "Request body exceeds 1 MB limit", 413);
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

/**
 * Parse JSON from raw body buffer.
 * Throws RunnerError(400) if body is not valid JSON.
 */
function parseBody(rawBody: Buffer, method: string): unknown {
  if (method === "GET" || method === "HEAD") return undefined;
  if (rawBody.length === 0) return undefined;

  const text = rawBody.toString("utf8");
  if (!text.trim()) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    throw new RunnerError("INVALID_JSON", "Request body is not valid JSON", 400);
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data, null, 2));
}

export type RouterOptions = {
  /** HMAC skew tolerance in ms. Default: 300000 (5min) */
  hmacSkewMs?: number;
  /** Nonce TTL in ms. Default: 300000 (5min) */
  nonceTtlMs?: number;
  /** Task idempotency TTL in ms. Default: 86400000 (24h) */
  taskIdempotencyTtlMs?: number;
  /**
   * Auth mode: 'hmac' for production HMAC auth, 'bearer' for legacy Bearer auth.
   * Default: 'hmac'
   */
  authMode?: "hmac" | "bearer";
};

export function createRouter(
  routes: Route[],
  runnerSecret: string,
  options: RouterOptions = {}
) {
  const {
    hmacSkewMs = 300_000,
    nonceTtlMs = 300_000,
    taskIdempotencyTtlMs = 86_400_000,
    authMode = "hmac"
  } = options;

  const nonceStore = new NonceStore(nonceTtlMs);
  const taskIdempotency = new TaskIdempotencyStore(taskIdempotencyTtlMs);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
      const route = routes.find((r) => r.method === req.method && r.path === url.pathname);
      if (!route) {
        send(res, 404, { ok: false, error: "NOT_FOUND" });
        return;
      }

      // ── Auth middleware (DEFAULT-DENY) ──────────────────────────────────
      if (!isPublicRoute(url.pathname)) {
        if (authMode === "hmac") {
          // Read raw body BEFORE auth (needed for body hash)
          const rawBody = await readRawBody(req, req.method ?? "GET");

          // HMAC verification
          const { nonce } = assertHmacAuthenticated(
            req,
            runnerSecret,
            rawBody,
            url.pathname,
            hmacSkewMs
          );

          // Nonce replay check
          nonceStore.checkAndMark(nonce, "runner");

          // Parse JSON AFTER auth succeeds
          const body = parseBody(rawBody, req.method ?? "GET");

          // Task idempotency check (if body has taskId)
          if (body && typeof body === "object" && "taskId" in body) {
            const taskId = (body as { taskId: string }).taskId;
            const agentId = (body as { agentId: string }).agentId ?? "unknown";
            if (taskId) {
              taskIdempotency.checkAndMark(taskId, agentId);
            }
          }

          // Raw handler (for MCP JSON-RPC, etc.)
          if (route.rawHandler) {
            // For raw handlers, we still need to re-inject the body
            // since they read from req directly. But auth is already done.
            await route.rawHandler(req, res, url);
            return;
          }

          const result = await route.handler!({
            req, res, url, body,
            rawBody
          });
          send(res, 200, result ?? { ok: true });

        } else {
          // Legacy Bearer auth mode
          assertAuthenticated(req, runnerSecret);

          // Raw handler
          if (route.rawHandler) {
            await route.rawHandler(req, res, url);
            return;
          }

          const rawBody = await readRawBody(req, req.method ?? "GET");
          const body = parseBody(rawBody, req.method ?? "GET");
          const result = await route.handler!({
            req, res, url, body,
            rawBody
          });
          send(res, 200, result ?? { ok: true });
        }

      } else {
        // Public route — no auth needed
        if (route.rawHandler) {
          await route.rawHandler(req, res, url);
          return;
        }

        const rawBody = await readRawBody(req, req.method ?? "GET");
        const body = parseBody(rawBody, req.method ?? "GET");
        const result = await route.handler!({
          req, res, url, body,
          rawBody
        });
        send(res, 200, result ?? { ok: true });
      }
    } catch (error) {
      const err = asRunnerError(error);
      send(res, err.status, {
        ok: false,
        code: err.code,
        error: err.message,
        details: err.details
      });
    }
  });

  return server;
}
