import { NextRequest, NextResponse } from 'next/server';
import { encodeFunctionData, keccak256, stringToHex, toBytes, toHex, type Hex } from 'viem';
import { AGENT_REGISTRY_ABI, JOB_ESCROW_ABI, CONTRACTS, ARC_TOKENS } from '@arclayer/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * ArcLayer MCP-style JSON endpoint — Pure Arc Reference Mode.
 *
 * Uses official Circle-deployed contracts:
 *   - ERC-8004 IdentityRegistry (0x8004A818…) — agent registration
 *   - ERC-8183 AgenticCommerce (0x0747EEf…) — job lifecycle
 *
 * Three call shapes:
 *   GET  /api/mcp                              → manifest + tool list
 *   GET  /api/mcp?tool=<name>&arg1=val1        → invoke read tool
 *   POST /api/mcp  { method, params }          → JSON-RPC 2.0 style
 *   POST /api/mcp  { tool, args }              → simple shape
 */

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://arclayers.xyz';
const ARC_CHAIN_ID = 5042002;
const ARC_RPC = 'https://rpc.testnet.arc.network';

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
  // ─── READ TOOLS ───────────────────────────────────────────────────────────────
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
    description: 'Get a single agent by tokenId (ERC-8004 NFT ID).',
    args: [{ name: 'tokenId', type: 'string', required: true }],
    kind: 'read',
    handler: async (args) => {
      const id = String(args.tokenId || '').trim();
      if (!id) throw new Error('tokenId required');
      const res = await fetch(new URL(`/api/indexer/agents/${encodeURIComponent(id)}`, BASE_URL), { cache: 'no-store' });
      if (!res.ok) throw new Error(`indexer ${res.status}`);
      return res.json();
    },
  },
  list_jobs: {
    description: 'List jobs from the indexer. Supports status filter.',
    args: [
      { name: 'status', type: 'string', description: 'created | funded | submitted | completed' },
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
    description: 'Aggregate totals from indexer: agents, jobs, volume.',
    args: [],
    kind: 'read',
    handler: async () => {
      const res = await fetch(new URL('/api/indexer/overview', BASE_URL), { cache: 'no-store' });
      return res.json();
    },
  },

  // ─── TX INSTRUCTION TOOLS (ERC-8004: Agent Registration) ──────────────────────
  register_agent_calldata: {
    description:
      'Build calldata for ERC-8004 IdentityRegistry.register(metadataURI). Mints an agent NFT. Returns tx instructions; the caller signs and sends.',
    args: [
      { name: 'metadataURI', type: 'string', required: true, description: 'Public agent manifest URL (HTTPS or IPFS).' },
    ],
    kind: 'tx_instruction',
    handler: async (args) => {
      const metadataURI = String(args.metadataURI || '').trim();
      if (!metadataURI) throw new Error('metadataURI required');

      const data = encodeFunctionData({
        abi: AGENT_REGISTRY_ABI as any,
        functionName: 'register',
        args: [metadataURI],
      });

      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.AGENT_REGISTRY,
        data,
        value: '0x0',
        derived: {
          note: 'tokenId is emitted in the Transfer(from=0x0, to, tokenId) event in the tx receipt.',
        },
        signing: {
          how: 'Send this transaction from your controller wallet on Arc Testnet (chainId 5042002).',
          rpc: ARC_RPC,
          gasHint: '~200000',
        },
        notes: [
          'ERC-8004 IdentityRegistry — register(string metadataURI) mints a new agent NFT.',
          'The tokenId is derived from the Transfer event (from=address(0)).',
          'metadataURI should point to a public agent manifest (e.g. /.well-known/agent.json).',
          'ArcLayer never holds your private key. Sign + broadcast yourself.',
        ],
      };
    },
  },

  // ─── TX INSTRUCTION TOOLS (ERC-8183: Job Lifecycle) ───────────────────────────
  create_job_calldata: {
    description:
      'Build calldata for ERC-8183 AgenticCommerce.createJob(provider, evaluator, expiredAt, description, hook). Returns tx instructions.',
    args: [
      { name: 'provider', type: 'string', required: true, description: 'Provider/worker wallet address.' },
      { name: 'evaluator', type: 'string', required: true, description: 'Evaluator wallet address.' },
      { name: 'expiredAt', type: 'string', required: true, description: 'Unix timestamp when job expires.' },
      { name: 'description', type: 'string', required: true, description: 'Job description string.' },
      { name: 'hook', type: 'string', description: 'Optional hook contract address (default: 0x0).' },
    ],
    kind: 'tx_instruction',
    handler: async (args) => {
      const provider = String(args.provider || '').trim();
      const evaluator = String(args.evaluator || '').trim();
      const expiredAt = String(args.expiredAt || '').trim();
      const description = String(args.description || '').trim();
      const hook = String(args.hook || '0x0000000000000000000000000000000000000000').trim();
      if (!provider || !evaluator || !expiredAt || !description) {
        throw new Error('provider, evaluator, expiredAt, description required');
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(provider)) throw new Error('provider is not a valid address');
      if (!/^0x[a-fA-F0-9]{40}$/.test(evaluator)) throw new Error('evaluator is not a valid address');

      const data = encodeFunctionData({
        abi: JOB_ESCROW_ABI as any,
        functionName: 'createJob',
        args: [provider as Hex, evaluator as Hex, BigInt(expiredAt), description, hook as Hex],
      });

      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.JOB_ESCROW,
        data,
        value: '0x0',
        derived: {
          note: 'jobId is emitted in the JobCreated event in the tx receipt.',
        },
        signing: {
          how: 'Send from the client wallet on Arc Testnet.',
          rpc: ARC_RPC,
          gasHint: '~300000',
        },
        lifecycle: [
          '1. createJob → get jobId from JobCreated event',
          '2. setBudget(jobId, amount)',
          '3. USDC.approve(AgenticCommerce, amount)',
          '4. fund(jobId, amount)',
          '5. Provider calls submit(jobId, deliverableHash)',
          '6. Evaluator calls complete(jobId)',
        ],
      };
    },
  },
  set_budget_calldata: {
    description:
      'Build calldata for ERC-8183 AgenticCommerce.setBudget(jobId, amount, optParams). Sets the USDC budget for a job.',
    args: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'amount', type: 'string', required: true, description: 'Budget in USDC atomic units (6 decimals). E.g. "1000000" = 1 USDC.' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    kind: 'tx_instruction',
    handler: async (args) => {
      const jobIdRaw = String(args.jobId || '').trim();
      const amountRaw = String(args.amount || '').trim();
      const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;
      if (!jobIdRaw || !amountRaw) throw new Error('jobId, amount required');

      const data = encodeFunctionData({
        abi: JOB_ESCROW_ABI as any,
        functionName: 'setBudget',
        args: [BigInt(jobIdRaw), BigInt(amountRaw), optParams],
      });

      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.JOB_ESCROW,
        data,
        value: '0x0',
        derived: { jobId: jobIdRaw, budgetAtomic: amountRaw, budgetUsdc: `${Number(amountRaw) / 1e6} USDC` },
        signing: {
          how: 'Send from the client wallet that created this job.',
          rpc: ARC_RPC,
          gasHint: '~80000',
        },
      };
    },
  },
  approve_usdc_calldata: {
    description:
      'Build calldata for USDC.approve(AgenticCommerce, amount). Must be called before fund().',
    args: [
      { name: 'amount', type: 'string', required: true, description: 'Amount in USDC atomic units (6 decimals).' },
    ],
    kind: 'tx_instruction',
    handler: async (args) => {
      const amountRaw = String(args.amount || '').trim();
      if (!amountRaw) throw new Error('amount required');

      const data = encodeFunctionData({
        abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }] as any,
        functionName: 'approve',
        args: [CONTRACTS.JOB_ESCROW as Hex, BigInt(amountRaw)],
      });

      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.USDC,
        data,
        value: '0x0',
        derived: { spender: CONTRACTS.JOB_ESCROW, amountAtomic: amountRaw, amountUsdc: `${Number(amountRaw) / 1e6} USDC` },
        signing: {
          how: 'Send from the client wallet that holds USDC. This approves AgenticCommerce to pull the specified amount.',
          rpc: ARC_RPC,
          gasHint: '~50000',
        },
      };
    },
  },
  fund_job_calldata: {
    description:
      'Build calldata for ERC-8183 AgenticCommerce.fund(jobId, optParams). Pulls the previously set budget from client into escrow.',
    args: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    kind: 'tx_instruction',
    handler: async (args) => {
      const jobIdRaw = String(args.jobId || '').trim();
      const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;
      if (!jobIdRaw) throw new Error('jobId required');

      const data = encodeFunctionData({
        abi: JOB_ESCROW_ABI as any,
        functionName: 'fund',
        args: [BigInt(jobIdRaw), optParams],
      });

      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.JOB_ESCROW,
        data,
        value: '0x0',
        derived: { jobId: jobIdRaw, fundingSource: 'current job budget', optParams },
        signing: {
          how: 'Send from the client wallet. USDC.approve(AgenticCommerce, budget) must have been called first.',
          rpc: ARC_RPC,
          gasHint: '~120000',
        },
        prerequisites: [
          'Call set_budget_calldata first to set the job budget.',
          'Call approve_usdc_calldata to approve the escrow to pull USDC.',
        ],
      };
    },
  },
  submit_job_calldata: {
    description:
      'Build calldata for ERC-8183 AgenticCommerce.submit(jobId, deliverableHash, optParams). Called by the provider after completing the task.',
    args: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'deliverableHash', type: 'string', required: true, description: 'Keccak256 hash of the deliverable content.' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    kind: 'tx_instruction',
    handler: async (args) => {
      const jobIdRaw = String(args.jobId || '').trim();
      const deliverableHash = String(args.deliverableHash || '').trim();
      const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;
      if (!jobIdRaw || !deliverableHash) throw new Error('jobId, deliverableHash required');

      const data = encodeFunctionData({
        abi: JOB_ESCROW_ABI as any,
        functionName: 'submit',
        args: [BigInt(jobIdRaw), deliverableHash as Hex, optParams],
      });

      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.JOB_ESCROW,
        data,
        value: '0x0',
        derived: { jobId: jobIdRaw, deliverableHash },
        signing: {
          how: 'Send from the provider wallet assigned to this job.',
          rpc: ARC_RPC,
          gasHint: '~200000',
        },
        invariants: [
          'Only the designated provider can submit.',
          'Job must be in funded state.',
        ],
      };
    },
  },
  complete_job_calldata: {
    description:
      'Build calldata for ERC-8183 AgenticCommerce.complete(jobId, reason, optParams). Called by the evaluator to approve and settle the job. `reason` is a bytes32 (defaults to keccak256("approved")).',
    args: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'reason', type: 'string', description: 'Reason string (will be keccak256-hashed) OR a 0x-prefixed 32-byte hash. Default keccak256("approved").' },
      { name: 'reasonHash', type: 'string', description: 'Optional pre-computed bytes32 reason hash; takes precedence over `reason`.' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    kind: 'tx_instruction',
    handler: async (args) => {
      const jobIdRaw = String(args.jobId || '').trim();
      if (!jobIdRaw) throw new Error('jobId required');

      const reasonHashRaw = String(args.reasonHash || '').trim();
      const reasonRaw = String(args.reason || '').trim();
      const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;

      let resolvedReason: Hex;
      if (reasonHashRaw) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(reasonHashRaw)) {
          throw new Error('reasonHash must be 0x-prefixed 32-byte hex');
        }
        resolvedReason = reasonHashRaw as Hex;
      } else if (reasonRaw) {
        resolvedReason = (reasonRaw.startsWith('0x') && reasonRaw.length === 66
          ? reasonRaw
          : keccak256(toBytes(reasonRaw))) as Hex;
      } else {
        // Default = keccak256("approved")
        resolvedReason = keccak256(toBytes('approved')) as Hex;
      }

      const data = encodeFunctionData({
        abi: JOB_ESCROW_ABI as any,
        functionName: 'complete',
        args: [BigInt(jobIdRaw), resolvedReason, optParams],
      });

      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.JOB_ESCROW,
        data,
        value: '0x0',
        derived: { jobId: jobIdRaw, reason: resolvedReason, optParams },
        signing: {
          how: 'Send from the evaluator wallet. Releases escrowed USDC to the provider.',
          rpc: ARC_RPC,
          gasHint: '~150000',
        },
        invariants: [
          'Only the evaluator can call complete.',
          'Job must have a submitted deliverable.',
          'Releases escrowed USDC to provider upon completion.',
        ],
      };
    },
  },

  // ─── ARC DOCS PROXY ───────────────────────────────────────────────────────────
  arc_docs_search: {
    description:
      'Search Arc Network documentation. Proxies to the official Arc MCP server for doc retrieval.',
    args: [
      { name: 'query', type: 'string', required: true, description: 'Search query for Arc docs.' },
    ],
    kind: 'read',
    handler: async (args) => {
      const query = String(args.query || '').trim();
      if (!query) throw new Error('query required');
      // Proxy to official Arc docs — try llms.txt first
      try {
        const res = await fetch('https://developers.circle.com/llms.txt', { cache: 'no-store' });
        const text = await res.text();
        // Simple keyword search in llms.txt
        const lines = text.split('\n');
        const matches = lines.filter((l) => l.toLowerCase().includes(query.toLowerCase()));
        return {
          source: 'developers.circle.com/llms.txt',
          query,
          results: matches.slice(0, 20),
          totalMatches: matches.length,
          fullDocsUrl: 'https://docs.arc.io',
          mcpServer: 'https://docs.arc.io/ai/mcp',
        };
      } catch (e: any) {
        return { error: e.message, fallback: 'https://docs.arc.io' };
      }
    },
  },
  arc_network_info: {
    description: 'Get Arc Network configuration: chain ID, RPC, contracts, explorer, faucet.',
    args: [],
    kind: 'read',
    handler: async () => {
      return {
        network: 'Arc Testnet',
        chainId: ARC_CHAIN_ID,
        rpc: ARC_RPC,
        explorer: 'https://testnet.arcscan.app',
        faucet: 'https://faucet.circle.com',
        nativeGasToken: 'USDC (18 decimals)',
        contracts: {
          identityRegistry_ERC8004: CONTRACTS.AGENT_REGISTRY,
          agenticCommerce_ERC8183: CONTRACTS.JOB_ESCROW,
          usdc_ERC20: CONTRACTS.USDC,
          eurc: ARC_TOKENS.EURC,
        },
        cctpDomain: 26,
        docs: {
          main: 'https://docs.arc.io',
          mcp: 'https://docs.arc.io/ai/mcp',
          erc8004: 'https://docs.arc.io/arc/tutorials/register-your-first-ai-agent.md',
          erc8183: 'https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job.md',
          evmCompat: 'https://docs.arc.io/arc/references/evm-compatibility.md',
        },
      };
    },
  },
};

// ─── MANIFEST ─────────────────────────────────────────────────────────────────
function buildManifest() {
  return {
    name: 'ArcLayer MCP',
    version: '2.0.0',
    description:
      'ArcLayer on-chain agent economy — Pure Arc Reference Mode. Uses official Circle ERC-8004 (IdentityRegistry) + ERC-8183 (AgenticCommerce) contracts on Arc Testnet.',
    network: {
      name: 'Arc Testnet',
      chainId: ARC_CHAIN_ID,
      rpc: ARC_RPC,
      explorer: 'https://testnet.arcscan.app',
      faucet: 'https://faucet.circle.com',
    },
    contracts: {
      identityRegistry_ERC8004: CONTRACTS.AGENT_REGISTRY,
      agenticCommerce_ERC8183: CONTRACTS.JOB_ESCROW,
      usdc_ERC20: CONTRACTS.USDC,
      eurc: ARC_TOKENS.EURC,
    },
    tools: Object.entries(TOOLS).map(([name, t]) => ({
      name,
      description: t.description,
      kind: t.kind,
      args: t.args,
    })),
    docs: {
      arc: 'https://docs.arc.io',
      mcp: 'https://docs.arc.io/ai/mcp',
      circle: 'https://developers.circle.com/llms.txt',
    },
  };
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────
async function invokeTool(name: string, args: Record<string, unknown>) {
  const tool = TOOLS[name];
  if (!tool) {
    return { error: `Unknown tool: ${name}. Available: ${Object.keys(TOOLS).join(', ')}` };
  }
  try {
    const result = await tool.handler(args);
    return { tool: name, kind: tool.kind, result };
  } catch (e: any) {
    return { tool: name, error: e.message || String(e) };
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const toolName = searchParams.get('tool');

  if (!toolName) {
    return NextResponse.json(buildManifest());
  }

  const args: Record<string, unknown> = {};
  searchParams.forEach((v, k) => {
    if (k !== 'tool') args[k] = v;
  });

  const out = await invokeTool(toolName, args);
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // JSON-RPC 2.0 shape
  if (body.method) {
    const out = await invokeTool(body.method, body.params || {});
    return NextResponse.json({ jsonrpc: '2.0', id: body.id ?? null, result: out });
  }

  // Simple shape
  if (body.tool) {
    const out = await invokeTool(body.tool, body.args || {});
    return NextResponse.json(out);
  }

  return NextResponse.json({ error: 'Provide { tool, args } or { method, params }' }, { status: 400 });
}
