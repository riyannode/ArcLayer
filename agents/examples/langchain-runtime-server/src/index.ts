/**
 * LangChain Runtime Server for ArcLayer Runner.
 *
 * Exposes:
 *   GET  /health  — readiness probe
 *   POST /run     — execute AgentTask via LangChain/OpenAI, return RuntimeResult
 *
 * Environment:
 *   OPENAI_API_KEY       — required
 *   OPENAI_MODEL         — optional, default "gpt-4o"
 *   RUNTIME_PORT         — optional, default 8788
 *   RUNTIME_HOST         — optional, default "127.0.0.1"
 *   RUNTIME_SECRET       — optional, if set, requires Bearer auth on POST /run
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  type AgentTask,
  type RuntimeResult,
} from "@arclayer/runner-core";

// ── Config ──────────────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";
const PORT = Number(process.env.RUNTIME_PORT ?? "8788");
const HOST = process.env.RUNTIME_HOST ?? "127.0.0.1";
const SECRET = process.env.RUNTIME_SECRET;

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}

// ── LLM Setup ──────────────────────────────────────────────────────────────

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "";
const llmConfig: Record<string, unknown> = {
  model: OPENAI_MODEL,
  apiKey: OPENAI_API_KEY,
  temperature: 0.2,
  maxTokens: 4096,
};
if (OPENAI_BASE_URL) {
  llmConfig.configuration = { baseURL: OPENAI_BASE_URL };
}
const llm = new ChatOpenAI(llmConfig);

// ── Task Execution ──────────────────────────────────────────────────────────

function extractDescription(task: AgentTask): string {
  const input = task.input;
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (typeof record.description === "string") return record.description;
    if (typeof record.prompt === "string") return record.prompt;
    if (typeof record.task === "string") return record.task;
    // Fall back to JSON
    return JSON.stringify(input, null, 2);
  }
  return String(input ?? "");
}

function buildSystemPrompt(task: AgentTask): string {
  const role = task.role ?? "provider";
  const parts = [
    `You are an ArcLayer ${role} agent executing an ERC-8183 job.`,
    "",
    "Your task is to produce a high-quality deliverable for the assigned job.",
    "Return your result as a clear, structured output.",
    "",
    "Rules:",
    "- Do not invent job IDs, wallet addresses, or transaction hashes.",
    "- Do not attempt on-chain operations — the orchestrator handles settlement.",
    "- Focus on the task: produce the deliverable output.",
    "- If the task is unclear or impossible, explain why in your output.",
  ];

  if (task.metadata && Object.keys(task.metadata).length > 0) {
    parts.push("", "Job metadata:", JSON.stringify(task.metadata, null, 2));
  }

  return parts.join("\n");
}

async function executeTask(task: AgentTask): Promise<RuntimeResult> {
  const description = extractDescription(task);
  const systemPrompt = buildSystemPrompt(task);

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(description),
    ]);

    const output = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

    return {
      ok: true,
      status: "completed",
      output,
      artifacts: [],
      paymentRequests: [],
      actionRequests: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Sanitize error — strip potential secrets
    const sanitized = message
      .replace(/sk-[a-zA-Z0-9]+/g, "sk-[REDACTED]")
      .replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, "bearer [REDACTED]")
      .slice(0, 500);

    return {
      ok: false,
      status: "failed",
      output: `Runtime execution failed: ${sanitized}`,
      artifacts: [],
      paymentRequests: [],
      actionRequests: [],
    };
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

function checkAuth(req: IncomingMessage): boolean {
  if (!SECRET) return true;
  const auth = req.headers.authorization;
  if (!auth) return false;
  const token = auth.replace(/^Bearer\s+/i, "");
  return token === SECRET;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  // ── GET /health ──────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "langchain-runtime-server",
      model: OPENAI_MODEL,
      port: PORT,
    });
    return;
  }

  // ── POST /run ────────────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/run") {
    if (!checkAuth(req)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: "Failed to read request body" });
      return;
    }

    let task: AgentTask;
    try {
      const parsed = JSON.parse(body);
      task = parsed as AgentTask;
      // Basic validation
      if (!task.taskId || !task.agentId) {
        sendJson(res, 400, { ok: false, error: "taskId and agentId are required" });
        return;
      }
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      return;
    }

    try {
      const result = await executeTask(task);
      sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, {
        ok: false,
        status: "failed",
        output: `Internal error: ${message.slice(0, 500)}`,
        artifacts: [],
        paymentRequests: [],
        actionRequests: [],
      } satisfies RuntimeResult);
    }
    return;
  }

  // ── 404 ──────────────────────────────────────────────────────────────
  sendJson(res, 404, { ok: false, error: "Not found" });
});

// ── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, HOST, () => {
  console.log(`[langchain-runtime-server] listening on http://${HOST}:${PORT}`);
  console.log(`[langchain-runtime-server] model: ${OPENAI_MODEL}`);
  console.log(`[langchain-runtime-server] auth: ${SECRET ? "enabled" : "disabled"}`);
});

// ── Graceful Shutdown ───────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`[langchain-runtime-server] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
