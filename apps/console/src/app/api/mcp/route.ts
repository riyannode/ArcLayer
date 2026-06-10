/**
 * ArcLayer Global MCP — Thin route handler.
 *
 * Parses HTTP request, creates RequestContext, delegates to server helpers.
 * All tool logic lives in apps/console/src/lib/mcp/server.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/mcp/registry';
import { handleMcpPost, handleMcpGet } from '@/lib/mcp/server';
import { MCP_OAUTH_CHALLENGE } from '@/lib/mcp/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function buildContext(req: NextRequest, method: string): RequestContext {
  const url = new URL(req.url);
  return {
    origin: url.origin,
    method,
    userAgent: req.headers.get('user-agent'),
    ip: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null,
    authorization: req.headers.get('authorization'),
  };
}

function wantsHtml(req: NextRequest): boolean {
  const accept = req.headers.get('accept') ?? '';
  const { searchParams } = new URL(req.url);

  // Preserve JSON/tool behavior for MCP clients, curl, and explicit manifest reads.
  if (searchParams.has('tool')) return false;
  if (searchParams.get('format') === 'json') return false;

  return accept.includes('text/html');
}

function wantsPrettyJson(req: NextRequest): boolean {
  const { searchParams } = new URL(req.url);
  return searchParams.get('format') === 'json' || searchParams.get('pretty') === '1';
}

function mcpLandingHtml(origin: string): string {
  const endpoint = `${origin}/api/mcp`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ArcLayer Global MCP</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #05070b;
      --panel: rgba(255,255,255,0.06);
      --panel-strong: rgba(255,255,255,0.09);
      --border: rgba(255,255,255,0.14);
      --text: #f8fafc;
      --muted: #94a3b8;
      --soft: #cbd5e1;
      --accent: #facc15;
      --code: #0b1220;
    }
    * { box-sizing: border-box; }
    html { overflow-x: hidden; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(250,204,21,0.16), transparent 34rem),
        radial-gradient(circle at bottom right, rgba(245,158,11,0.16), transparent 34rem),
        var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
      overflow-x: hidden;
    }
    main {
      width: 100%;
      max-width: 980px;
      border: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04));
      border-radius: 24px;
      padding: 32px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.38);
      overflow: hidden;
    }
    .badge {
      display: inline-flex;
      border: 1px solid rgba(250,204,21,0.32);
      color: var(--accent);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: clamp(34px, 6vw, 64px);
      line-height: .95;
      letter-spacing: -0.05em;
    }
    p {
      color: var(--muted);
      font-size: 16px;
      line-height: 1.65;
      margin: 0 0 22px;
      max-width: 760px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin: 24px 0;
    }
    .card {
      min-width: 0;
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 16px;
      padding: 16px;
    }
    .card strong {
      display: block;
      margin-bottom: 6px;
      color: var(--text);
    }
    .card span, .card code { color: var(--soft); }
    .card code {
      display: block;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: normal;
    }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    pre {
      max-width: 100%;
      background: var(--code);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      overflow-x: auto;
      color: #dbeafe;
      line-height: 1.6;
      margin: 12px 0 0;
    }
    a { color: inherit; text-decoration: none; }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 22px;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 14px;
      color: var(--text);
      background: var(--panel-strong);
    }
    .button.primary {
      border-color: rgba(250,204,21,0.36);
      color: #1a1400;
      background: var(--accent);
      font-weight: 700;
    }
    .section-title {
      margin-top: 28px;
      margin-bottom: 8px;
      color: var(--text);
      font-size: 14px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    @media (max-width: 640px) {
      body {
        align-items: flex-start;
        padding: 18px;
        padding-top: 40px;
      }
      main {
        border-radius: 20px;
        padding: 22px;
      }
      h1 {
        font-size: clamp(38px, 11vw, 52px);
        letter-spacing: -0.06em;
      }
      p {
        font-size: 15px;
      }
      .grid {
        grid-template-columns: 1fr;
      }
      pre {
        font-size: 13px;
      }
      .actions {
        flex-direction: column;
      }
      .button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="badge">ArcLayer MCP Endpoint</div>
    <h1>ArcLayer Global MCP</h1>
    <p>
      Hosted MCP server for Arc Testnet agentic commerce tools. Use this endpoint from Claude,
      Codex, or external agent runtimes to read protocol status, discover agents, prepare ERC-8004
      identity transactions, and prepare ERC-8183 job lifecycle transactions.
    </p>

    <div class="grid">
      <div class="card">
        <strong>Endpoint</strong>
        <code>${endpoint}</code>
      </div>
      <div class="card">
        <strong>Network</strong>
        <span>Arc Testnet · chainId 5042002</span>
      </div>
      <div class="card">
        <strong>Standards</strong>
        <span>ERC-8004 · ERC-8183 · x402</span>
      </div>
    </div>

    <div class="section-title">Example JSON-RPC request</div>
    <pre>curl -s ${endpoint} \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}'</pre>

    <div class="actions">
      <a class="button primary" href="${endpoint}?format=json">View JSON manifest</a>
      <a class="button" href="/">Open console</a>
    </div>
  </main>
</body>
</html>`;
}

export async function GET(req: NextRequest) {
  const ctx = buildContext(req, 'GET');
  const url = new URL(req.url);

  if (wantsHtml(req)) {
    return new NextResponse(mcpLandingHtml(url.origin), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const result = await handleMcpGet(url.searchParams, ctx);

  if (wantsPrettyJson(req)) {
    return new NextResponse(JSON.stringify(result, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const ctx = buildContext(req, 'POST');
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: invalid JSON' } }, { status: 400 });
  }

  const { json, status } = await handleMcpPost(body, ctx);
  return NextResponse.json(json, { status, headers: status === 401 ? { 'WWW-Authenticate': MCP_OAUTH_CHALLENGE } : undefined });
}
