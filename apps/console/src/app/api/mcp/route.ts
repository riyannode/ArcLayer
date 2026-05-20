import { NextRequest, NextResponse } from 'next/server';
import { encodeFunctionData, keccak256, stringToHex, toHex, type Hex } from 'viem';
import { AGENT_REGISTRY_ABI, JOB_ESCROW_ABI } from '@arclayer/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * ArcLayer MCP-style JSON endpoint.
 *
 * Goal: any LLM/agent runtime can hit a single URL and discover what ArcLayer
 * exposes — list/read tools + tx-instruction builders. We do NOT auto-sign
 * anything. The runtime/wallet signs.
 *
 * Three call shapes:
 *   GET  /api/mcp                              → manifest + tool list
 *   GET  /api/mcp?tool=list_agents             → invoke read tool
 *   POST /api/mcp  { method, params }          → JSON-RPC 2.0 style
 *   POST /api/mcp  { tool, args }              → simple shape
 */

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://arclayers.xyz';
const ARC_CHAIN_ID = 5042002;
const CONTRACTS = {
  USDC: '0x3600000000000000000000000000000000000000',
  AGENT_REGISTRY: '0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21',
  JOB_ESCROW: '0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225',
  WORK_PROOF: '0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5',
  REPUTATION_ORACLE: '0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c',
} as const;

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

const TOOLS: Record<
  string,
  {
    description: string;
    args: Array<{ name: string; type: string; required?: boolean; description?: string }>;
    kind: 'read' | 'tx_instruction';
    handler: ToolHandler;
  }
> = {
  list_agents: {
    description: 'List all registered agents from the indexer.',
    args: [{ name: 'limit', type: 'number', description: 'Optional max count' }],
    kind: 'read',
    handler: async (args) => {
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(500, args.limit)) : undefined;
      const url = new URL('/api/indexer/agents', BASE_URL);
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      const list = Array.isArray(json) ? json : json.agents || json.data || [];
      return { agents: limit ? list.slice(0, limit) : list, total: list.length };
    },
  },
  get_agent: {
    description: 'Get a single agent by agentId.',
    args: [{ name: 'agentId', type: 'string', required: true }],
    kind: 'read',
    handler: async (args) => {
      const id = String(args.agentId || '').trim();
      if (!id) throw new Error('agentId required');
      const res = await fetch(new URL(`/api/indexer/agents/${encodeURIComponent(id)}`, BASE_URL), { cache: 'no-store' });
      if (!res.ok) throw new Error(`indexer ${res.status}`);
      return res.json();
    },
  },
  list_jobs: {
    description: 'List jobs from the indexer. Supports status filter.',
    args: [
      { name: 'status', type: 'string', description: 'open | funded | submitted | settled' },
      { name: 'limit', type: 'number' },
    ],
    kind: 'read',
    handler: async (args) => {
      const status = typeof args.status === 'string' ? args.status.toLowerCase() : undefined;
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(500, args.limit)) : undefined;
      const res = await fetch(new URL('/api/indexer/jobs', BASE_URL), { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      let list: any[] = Array.isArray(json) ? json : json.jobs || json.data || [];
      if (status) list = list.filter((j) => String(j.status || '').toLowerCase().includes(status));
      return { jobs: limit ? list.slice(0, limit) : list, total: list.length };
    },
  },
  get_job: {
    description: 'Get a single job by jobId.',
    args: [{ name: 'jobId', type: 'string', required: true }],
    kind: 'read',
    handler: async (args) => {
      const id = String(args.jobId || '').trim();
      if (!id) throw new Error('jobId required');
      const res = await fetch(new URL(`/api/indexer/jobs/${encodeURIComponent(id)}`, BASE_URL), { cache: 'no-store' });
      if (!res.ok) throw new Error(`indexer ${res.status}`);
      return res.json();
    },
  },
  protocol_overview: {
    description: 'Aggregate totals from indexer: agents, jobs, proofs, volume.',
    args: [],
    kind: 'read',
    handler: async () => {
      const res = await fetch(new URL('/api/indexer/overview', BASE_URL), { cache: 'no-store' });
      return res.json();
    },
  },
  register_agent_calldata: {
    description:
      'Build calldata for AgentRegistry.registerAgent(). Returns tx instructions; the caller signs and sends with their own wallet.',
    args: [
      { name: 'name', type: 'string', required: true, description: 'Agent display name (used to derive agentId).' },
      { name: 'skill', type: 'string', required: true, description: 'Primary skill label (used to derive skillHash).' },
      { name: 'metadataURI', type: 'string', required: true, description: 'Public manifest URL (HTTPS preferred).' },
    ],
    kind: 'tx_instruction',
    handler: async (args) => {
      const name = String(args.name || '').trim();
      const skill = String(args.skill || '').trim();
      const metadataURI = String(args.metadataURI || '').trim();
      if (!name || !skill || !metadataURI) throw new Error('name, skill, metadataURI required');

      const agentIdHash = keccak256(stringToHex(name.toLowerCase()));
      const agentId = BigInt(agentIdHash);
      const skillHash = keccak256(stringToHex(skill));

      const data = encodeFunctionData({
        abi: AGENT_REGISTRY_ABI as any,
        functionName: 'registerAgent',
        args: [agentId, skillHash, metadataURI],
      });

      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.AGENT_REGISTRY,
        data,
        value: '0x0',
        derived: {
          agentId: agentId.toString(),
          agentIdHex: toHex(agentId),
          skillHash,
        },
        signing: {
          how: 'Send this transaction from your controller wallet on Arc Testnet (chainId 5042002).',
          rpc: 'https://rpc.drpc.testnet.arc.network',
          gasHint: '~250000',
        },
        notes: [
          'agentId is keccak256(lowercase(name)) cast to uint256.',
          'skillHash is keccak256(skill).',
          'metadataURI should be a public manifest (e.g. /.well-known/arclayer-agent.json).',
          'ArcLayer never holds your private key. Sign + broadcast yourself.',
        ],
      };
    },
  },
  create_job_calldata: {
    description:
      'Build calldata for JobEscrow.createJob(). Returns tx instructions; the caller signs and sends. Worker MUST be different from the connected wallet (msg.sender).',
    args: [
      { name: 'agentId', type: 'string', required: true, description: 'Target agent (uint256).' },
      { name: 'worker', type: 'string', required: true, description: 'Worker wallet address (must != client/msg.sender).' },
      { name: 'evaluator', type: 'string', required: true, description: 'Evaluator wallet (UI label: "Client Address").' },
      { name: 'jobSpec', type: 'string', required: true, description: 'Plain task spec; hashed into jobSpecHash.' },
    ],
    kind: 'tx_instruction',
    handler: async (args) => {
      const agentIdRaw = String(args.agentId || '').trim();
      const worker = String(args.worker || '').trim();
      const evaluator = String(args.evaluator || '').trim();
      const jobSpec = String(args.jobSpec || '').trim();
      if (!agentIdRaw || !worker || !evaluator || !jobSpec) {
        throw new Error('agentId, worker, evaluator, jobSpec required');
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(worker)) throw new Error('worker is not a valid address');
      if (!/^0x[a-fA-F0-9]{40}$/.test(evaluator)) throw new Error('evaluator is not a valid address');
      if (worker.toLowerCase() === evaluator.toLowerCase()) {
        // not a contract revert but a UX foot-gun; flag but allow
      }

      const agentId = BigInt(agentIdRaw);
      const jobSpecHash = keccak256(stringToHex(jobSpec));

      const data = encodeFunctionData({
        abi: JOB_ESCROW_ABI as any,
        functionName: 'createJob',
        args: [agentId, worker as Hex, evaluator as Hex, jobSpecHash],
      });

      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.JOB_ESCROW,
        data,
        value: '0x0',
        derived: { agentId: agentId.toString(), jobSpecHash },
        signing: {
          how: 'Send from the client wallet on Arc Testnet. After mining, call setBudget(jobId, amount) → USDC.approve(JobEscrow, amount) → fund(jobId, amount).',
          rpc: 'https://rpc.drpc.testnet.arc.network',
          gasHint: '~300000',
        },
        invariants: [
          'createJob reverts if worker == msg.sender ("Worker is client").',
          'You must follow with setBudget + USDC approve + fund before the worker can submit.',
        ],
      };
    },
  },
};

function manifest() {
  return {
    schema: 'arclayer.mcp/v1',
    name: 'ArcLayer MCP',
    description: 'Read protocol state and build tx instructions. ArcLayer never auto-signs.',
    base: BASE_URL,
    network: { name: 'Arc Testnet', chainId: ARC_CHAIN_ID },
    contracts: CONTRACTS,
    invocation: {
      get: `${BASE_URL}/api/mcp?tool=<tool>&arg1=value1`,
      jsonRpc: { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: '<tool>', params: { /* args */ } } },
      simple: { method: 'POST', body: { tool: '<tool>', args: { /* args */ } } },
    },
    tools: Object.entries(TOOLS).map(([name, t]) => ({
      name,
      kind: t.kind,
      description: t.description,
      args: t.args,
    })),
  };
}

function jsonRpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}
function jsonRpcError(id: unknown, code: number, message: string, status = 400) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } }, { status });
}

async function invoke(tool: string, args: Record<string, unknown>) {
  const t = TOOLS[tool];
  if (!t) throw new Error(`unknown tool: ${tool}`);
  return t.handler(args || {});
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tool = url.searchParams.get('tool');
  if (!tool) return NextResponse.json(manifest());
  const args: Record<string, unknown> = {};
  url.searchParams.forEach((v, k) => {
    if (k === 'tool') return;
    args[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  });
  try {
    const result = await invoke(tool, args);
    return NextResponse.json({ ok: true, tool, result });
  } catch (e) {
    return NextResponse.json({ ok: false, tool, error: e instanceof Error ? e.message : 'error' }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 });
  }

  // JSON-RPC 2.0 shape
  if (body.jsonrpc === '2.0' && typeof body.method === 'string') {
    try {
      const result = await invoke(body.method, body.params || {});
      return jsonRpcResult(body.id ?? null, result);
    } catch (e) {
      return jsonRpcError(body.id ?? null, -32000, e instanceof Error ? e.message : 'error');
    }
  }

  // Simple shape
  if (typeof body.tool === 'string') {
    try {
      const result = await invoke(body.tool, body.args || {});
      return NextResponse.json({ ok: true, tool: body.tool, result });
    } catch (e) {
      return NextResponse.json(
        { ok: false, tool: body.tool, error: e instanceof Error ? e.message : 'error' },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ ok: false, error: 'expected { jsonrpc, method } or { tool, args }' }, { status: 400 });
}
