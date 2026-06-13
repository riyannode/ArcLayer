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
  /**
   * Reserve a task ID for idempotent execution.
   * Call AFTER schema/agent/role validation, immediately before dispatch.
   * Throws RunnerError(409) if taskId already reserved within TTL.
   * Optional — handlers that don't do task dispatch can omit.
   */
  reserveTaskId?: (taskId: string, agentId: string) => void;
  /**
   * Mark a reserved task as completed.
   * Call after successful dispatch.
   */
  markTaskCompleted?: (taskId: string, agentId: string) => void;
  /**
   * Mark a reserved task as failed.
   * Call after failed dispatch.
   */
  markTaskFailed?: (taskId: string, agentId: string) => void;
};

export type RouteHandler = (ctx: HandlerContext) => Promise<unknown>;

/**
 * Raw handler context — same as HandlerContext but for routes that write
 * directly to res (e.g. JSON-RPC MCP). Auth and body reading are already
 * done by the router; rawHandler MUST NOT re-read the request stream
 * or re-verify auth.
 */
export type RawHandlerContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** Raw body buffer as received (before JSON parse) */
  rawBody: Buffer;
  /** Parsed JSON body (undefined for GET/HEAD or empty body) */
  body: unknown;
};

export type RawRouteHandler = (ctx: RawHandlerContext) => Promise<void>;

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

          // HMAC verification — covers full request target including query string
          const signedTarget = `${url.pathname}${url.search}`;
          const { nonce } = assertHmacAuthenticated(
            req,
            runnerSecret,
            rawBody,
            signedTarget,
            hmacSkewMs
          );

          // Nonce replay check
          nonceStore.checkAndMark(nonce, "runner");

          // Parse JSON AFTER auth succeeds
          const body = parseBody(rawBody, req.method ?? "GET");

          // NOTE: Task idempotency is NOT checked at router level.
          // Handlers call ctx.reserveTaskId() after schema/role validation,
          // immediately before dispatch. This prevents burning taskId on
          // fixable validation errors.

          // Dispatch to handler — router owns auth, handler does NOT re-read req
          if (route.rawHandler) {
            await route.rawHandler({ req, res, url, rawBody, body });
          } else {
            const result = await route.handler!({
              req, res, url, body, rawBody,
              reserveTaskId: (taskId, agentId) => taskIdempotency.checkAndMark(taskId, agentId),
              markTaskCompleted: (taskId, agentId) => taskIdempotency.markCompleted(taskId, agentId),
              markTaskFailed: (taskId, agentId) => taskIdempotency.markFailed(taskId, agentId),
            });
            send(res, 200, result ?? { ok: true });
          }

        } else {
          // Legacy Bearer auth mode
          assertAuthenticated(req, runnerSecret);

          if (route.rawHandler) {
            const rawBody = await readRawBody(req, req.method ?? "GET");
            const body = parseBody(rawBody, req.method ?? "GET");
            await route.rawHandler({ req, res, url, rawBody, body });
          } else {
            const rawBody = await readRawBody(req, req.method ?? "GET");
            const body = parseBody(rawBody, req.method ?? "GET");
            const result = await route.handler!({
              req, res, url, body, rawBody,
              reserveTaskId: (taskId, agentId) => taskIdempotency.checkAndMark(taskId, agentId),
              markTaskCompleted: (taskId, agentId) => taskIdempotency.markCompleted(taskId, agentId),
              markTaskFailed: (taskId, agentId) => taskIdempotency.markFailed(taskId, agentId),
            });
            send(res, 200, result ?? { ok: true });
          }
        }

      } else {
        // Public route — no auth needed
        if (route.rawHandler) {
          const rawBody = await readRawBody(req, req.method ?? "GET");
          const body = parseBody(rawBody, req.method ?? "GET");
          await route.rawHandler({ req, res, url, rawBody, body });
        } else {
          const rawBody = await readRawBody(req, req.method ?? "GET");
          const body = parseBody(rawBody, req.method ?? "GET");
          const result = await route.handler!({ req, res, url, body, rawBody });
          send(res, 200, result ?? { ok: true });
        }
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
