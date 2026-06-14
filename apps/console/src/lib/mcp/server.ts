/**
 * ArcLayer Global MCP — Server.
 *
 * Thin dispatch layer. All tool registrations live in tool-catalog.ts.
 * This file provides: buildManifest, invokeTool, handleMcpPost, handleMcpGet.
 *
 * Will be replaced by sdk-server.ts in Commit 3.
 */

import type { McpToolDefinition, McpToolContext, RequestContext } from './registry';
import { getTool, listTools } from './registry';
import { MCP_ERRORS, McpError, thrownToMcpError, jsonRpcResult, jsonRpcError, okResult } from './errors';
import { redactString } from './redact';
import { resolveMcpBearerAuth } from './auth';
import { hasMcpScope } from './scope-check';
import { registerAllTools } from './tool-catalog';
import { CONTRACTS, ARC_TOKENS } from '@arclayer/sdk';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const ARC_CHAIN_ID = 5042002;
const MCP_VERSION = '0.1.0';
const MCP_SERVER_NAME = 'arclayer-global-mcp';
const PROTOCOL_VERSION = '2025-06-18';

// ─── MANIFEST ────────────────────────────────────────────────────────────────

export function buildManifest(_ctx?: RequestContext) {
  registerAllTools();
  return {
    name: MCP_SERVER_NAME,
    version: MCP_VERSION,
    description:
      'ArcLayer Global MCP — agentic commerce tools on Arc Testnet. This is NOT the official Arc MCP server (https://docs.arc.io/mcp).',
    network: {
      name: 'Arc Testnet',
      chainId: ARC_CHAIN_ID,
      rpc: 'https://rpc.drpc.testnet.arc.network',
      explorer: 'https://testnet.arcscan.app',
      faucet: 'https://faucet.circle.com',
    },
    contracts: {
      identityRegistry_ERC8004: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
      reputationRegistry_ERC8004: CONTRACTS.ERC8004_REPUTATION_REGISTRY,
      validationRegistry_ERC8004: CONTRACTS.ERC8004_VALIDATION_REGISTRY,
      agenticCommerce_ERC8183: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      usdc_ERC20: CONTRACTS.USDC,
      eurc: ARC_TOKENS.EURC,
    },
    tools: listTools().map((t) => ({
      name: t.name,
      description: t.description,
      operation: t.operation,
      scope: t.requiredScope,
      args: t.inputSchema,
    })),
    docs: {
      arc: 'https://docs.arc.io',
      llms: 'https://docs.arc.io/llms.txt',
      mcp: 'https://docs.arc.io/mcp',
    },
  };
}

// ─── INVOKE TOOL ─────────────────────────────────────────────────────────────

async function invokeTool(
  name: string,
  args: Record<string, unknown>,
  context: McpToolContext,
): Promise<unknown> {
  registerAllTools();
  const tool = getTool(name);
  if (!tool) {
    throw new McpError(MCP_ERRORS.UNKNOWN_TOOL, `Unknown tool: ${name}`);
  }

  // All tools require scope verification (no public tools after hard cut)
  const auth = context.auth ?? await resolveMcpBearerAuth(context.request.authorization);
  if (!auth) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'Valid OAuth bearer token or runtime session token required', 401);
  }
  if (!hasMcpScope(auth.scopes, tool.requiredScope)) {
    throw new McpError(MCP_ERRORS.FORBIDDEN, `Missing required scope: ${tool.requiredScope}`, 403);
  }
  context.auth = auth;

  return tool.handler(args, context);
}

// ─── HANDLE POST ─────────────────────────────────────────────────────────────

export async function handleMcpPost(
  body: unknown,
  ctx: RequestContext,
): Promise<{ json: unknown; status: number }> {
  registerAllTools();
  const mcpCtx: McpToolContext = { request: ctx };

  // Validate basic JSON-RPC shape
  if (!body || typeof body !== 'object') {
    return { json: jsonRpcError(null, MCP_ERRORS.INVALID_REQUEST, 'Request body must be a JSON object'), status: 400 };
  }

  const b = body as Record<string, unknown>;
  const id = (b.id as string | number | null) ?? null;

  // ── JSON-RPC shape: { method, params } ─────────────────────────────────
  if (typeof b.method === 'string') {
    const method = b.method;
    const params = (b.params && typeof b.params === 'object' ? b.params : {}) as Record<string, unknown>;

    // initialize
    if (method === 'initialize') {
      return {
        json: jsonRpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: { name: MCP_SERVER_NAME, version: MCP_VERSION },
          capabilities: { tools: {} },
        }),
        status: 200,
      };
    }

    // tools/list
    if (method === 'tools/list') {
      const toolsList = listTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: {
          type: 'object' as const,
          properties: Object.fromEntries(
            t.inputSchema.map((p) => [
              p.name,
              {
                type: p.type,
                ...(p.description ? { description: p.description } : {}),
              },
            ]),
          ),
          required: t.inputSchema.filter((p) => p.required).map((p) => p.name),
        },
        annotations: t.annotations,
      }));
      return { json: jsonRpcResult(id, { tools: toolsList }), status: 200 };
    }

    // tools/call
    if (method === 'tools/call') {
      const toolName = params.name;
      if (typeof toolName !== 'string' || !toolName.trim()) {
        return { json: jsonRpcError(id, MCP_ERRORS.VALIDATION_ERROR, 'params.name must be a non-empty string'), status: 400 };
      }
      const toolArgs = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
      try {
        const result = await invokeTool(toolName.trim(), toolArgs, mcpCtx);
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { json: jsonRpcResult(id, okResult(text, result as Record<string, unknown>)), status: 200 };
      } catch (e) {
        const mcpErr = thrownToMcpError(e);
        return { json: jsonRpcError(id, mcpErr.code, redactString(mcpErr.message)), status: mcpErr.status };
      }
    }

    // Unknown method
    return { json: jsonRpcError(id, MCP_ERRORS.UNKNOWN_METHOD, `Unknown method: ${method}`), status: 400 };
  }

  return { json: jsonRpcError(id, MCP_ERRORS.INVALID_REQUEST, 'Provide { jsonrpc, method, params }'), status: 400 };
}

// ─── HANDLE GET ──────────────────────────────────────────────────────────────

export async function handleMcpGet(
  searchParams: URLSearchParams,
  ctx: RequestContext,
): Promise<unknown> {
  registerAllTools();
  return buildManifest(ctx);
}
