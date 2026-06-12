import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  asRunnerError,
  RunnerError,
  assertAuthenticated,
  isPublicRoute
} from "@arclayer/runner-core";

export type HandlerContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: unknown;
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

async function readBody(req: IncomingMessage, method: string): Promise<unknown> {
  if (method === "GET" || method === "HEAD") return undefined;

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

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;

  try {
    return JSON.parse(raw);
  } catch {
    throw new RunnerError("INVALID_JSON", "Request body is not valid JSON", 400);
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data, null, 2));
}

export function createRouter(routes: Route[], runnerSecret: string) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
      const route = routes.find((r) => r.method === req.method && r.path === url.pathname);
      if (!route) {
        send(res, 404, { ok: false, error: "NOT_FOUND" });
        return;
      }

      // ── Auth middleware (DEFAULT-DENY) ──────────────────────────────────
      if (!isPublicRoute(url.pathname)) {
        assertAuthenticated(req, runnerSecret);
      }

      // Raw handler (for MCP JSON-RPC, etc.)
      if (route.rawHandler) {
        await route.rawHandler(req, res, url);
        return;
      }

      const body = await readBody(req, req.method ?? "GET");
      const result = await route.handler!({ req, res, url, body });
      send(res, 200, result ?? { ok: true });
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
}
