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

type Route = {
  method: string;
  path: string;
  handler: RouteHandler;
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
      // Only explicitly public routes skip auth.
      // Every other route — including unknown/new routes — requires auth.
      if (!isPublicRoute(url.pathname)) {
        assertAuthenticated(req, runnerSecret);
      }

      const body = await readBody(req);
      const result = await route.handler({ req, res, url, body });
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
