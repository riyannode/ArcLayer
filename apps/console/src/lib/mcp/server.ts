/**
 * ArcLayer Global MCP — Server.
 *
 * Contains all tool implementations, registration, and MCP JSON-RPC dispatch.
 * Route layer is a thin passthrough; all logic lives here.
 */

import { encodeFunctionData, keccak256, toBytes, type Hex } from 'viem';
import {
  ERC8004_IDENTITY_REGISTRY_ABI,
  ERC8004_REPUTATION_REGISTRY_ABI,
  ERC8004_VALIDATION_REGISTRY_ABI,
  ERC8183_AGENTIC_COMMERCE_ABI,
  CONTRACTS,
  ARC_TOKENS,
} from '@arclayer/sdk';
import { indexerUrl } from '@/lib/indexer';
import {
  handleJobsGetOnchainStatus,
  handleJobsGetLifecycleSummary,
  handleClientPrepareCreateJobForSession,
  handleClientPrepareCreateOpenJobForSession,
  handleClientPrepareSetProviderForSession,
  handleProviderPrepareSetBudgetForSession,
  handleClientPrepareFundJobBundleForSession,
  handleProviderPrepareSubmitJobForSession,
  handleEvaluatorPrepareCompleteJobForSession,
  handleClientPrepareRejectJobForSession,
  handleEvaluatorPrepareRejectJobForSession,
  handleClientPrepareClaimRefundForSession,
} from './erc8183-tools';
import {
  type McpToolDefinition,
  type McpToolContext,
  type RequestContext,
  registerTool,
  getTool,
  listTools,
  hasTool,
  toMcpToolSchema,
} from './registry';
import {
  MCP_ERRORS,
  McpError,
  okResult,
  errorResult,
  jsonRpcResult,
  jsonRpcError,
  thrownToMcpError,
} from './errors';
import { redactString } from './redact';
import {
  handleGetAgentAccount,
  handlePrepareRegisterAgent,
  handleRequestRegisterAgentApproval,
  handleGetRegistrationStatus,
} from './identity-tools';
import {
  handleCreateApiKey,
  handleListApiKeys,
  handleRevokeApiKey,
} from './api-key-tools';
import {
  handleProviderRuntimeGetContext,
  handleProviderRuntimeHeartbeat,
  handleProviderRuntimeStartJob,
  handleProviderRuntimeWriteCheckpoint,
  handleProviderRuntimeGetResumePlan,
  handleProviderListOpenJobs,
  handleProviderApplyOpenJob,
  handleProviderWithdrawOpenJobApplication,
  handleProviderListMyOpenJobApplications,
} from './provider-runtime-tools';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = 'https://rpc.drpc.testnet.arc.network';
const MCP_VERSION = '0.1.0';
const MCP_SERVER_NAME = 'arclayer-global-mcp';
const PROTOCOL_VERSION = '2024-11-05';

// ─── TOOL REGISTRATION ───────────────────────────────────────────────────────

let registered = false;

/**
 * Register all tools into the global registry.
 * Idempotent — safe to call multiple times.
 */
export function registerAllTools(): void {
  if (registered) return;
  registered = true;

  // ── READ: protocol ──────────────────────────────────────────────────────

  registerTool({
    name: 'protocol.status',
    domain: 'protocol',
    description: 'Get Arc Network configuration: chain ID, RPC, contracts, explorer, faucet.',
    authRequired: false,
    roles: [],
    inputSchema: [],
    legacyAliases: ['arc_network_info'],
    kind: 'read',
    handler: async () => ({
      network: 'Arc Testnet',
      chainId: ARC_CHAIN_ID,
      rpc: ARC_RPC,
      explorer: 'https://testnet.arcscan.app',
      faucet: 'https://faucet.circle.com',
      nativeGasToken: 'USDC (18 decimals)',
      contracts: {
        identityRegistry_ERC8004: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
        reputationRegistry_ERC8004: CONTRACTS.ERC8004_REPUTATION_REGISTRY,
        validationRegistry_ERC8004: CONTRACTS.ERC8004_VALIDATION_REGISTRY,
        agenticCommerce_ERC8183: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        usdc_ERC20: CONTRACTS.USDC,
        eurc: ARC_TOKENS.EURC,
      },
      cctpDomain: 26,
      supportedStandards: ['ERC-8004', 'ERC-8183', 'x402'],
      mcpVersion: MCP_VERSION,
      docs: {
        main: 'https://docs.arc.io',
        mcpDocs: 'https://docs.arc.io/ai/mcp',
        mcpServer: 'https://docs.arc.io/mcp',
        erc8004: 'https://docs.arc.io/arc/tutorials/register-your-first-ai-agent.md',
        erc8183: 'https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job.md',
      },
    }),
  });

  registerTool({
    name: 'protocol.health',
    domain: 'protocol',
    description: 'Aggregate protocol health: indexer liveness + timestamp.',
    authRequired: false,
    roles: [],
    inputSchema: [],
    legacyAliases: ['protocol_overview'],
    kind: 'read',
    handler: async () => {
      const BUDGET_MS = 2000;
      const ts = new Date().toISOString();

      // Run health + overview in parallel under a single 2s budget.
      const [healthResult, overviewResult] = await Promise.allSettled([
        fetch(indexerUrl('/health'), { cache: 'no-store', signal: AbortSignal.timeout(BUDGET_MS) }),
        fetch(indexerUrl('/overview'), { cache: 'no-store', signal: AbortSignal.timeout(BUDGET_MS) }).then((r) => r.json().catch(() => null)),
      ]);

      const indexerOk = healthResult.status === 'fulfilled' && healthResult.value.ok;
      const overview = overviewResult.status === 'fulfilled' ? overviewResult.value : null;

      if (!indexerOk) {
        return { ok: true, status: 'degraded', indexerOk: false, reason: 'indexer_timeout', timestamp: ts };
      }

      return { ok: true, status: 'healthy', indexerOk: true, timestamp: ts, overview };
    },
  });

  // ── READ: agents ─────────────────────────────────────────────────────────

  registerTool({
    name: 'agents.discover',
    domain: 'agents',
    description: 'List all registered agents from the indexer.',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'limit', type: 'number', description: 'Optional max count (1-50).' },
      { name: 'role', type: 'string', description: 'Optional role filter.' },
      { name: 'capability', type: 'string', description: 'Optional capability filter.' },
    ],
    legacyAliases: ['list_agents'],
    kind: 'read',
    handler: async (args) => {
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, args.limit)) : undefined;
      const roleFilter = typeof args.role === 'string' ? args.role.toLowerCase().trim() : undefined;
      const capabilityFilter = typeof args.capability === 'string' ? args.capability.toLowerCase().trim() : undefined;
      const res = await fetch(indexerUrl('/agents'), { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      let list: unknown[] = Array.isArray(json) ? json : json.agents || json.data || [];

      // Apply role filter: match agent.role, agent.roles[].name, or agent.roles[].id
      if (roleFilter) {
        list = list.filter((a: any) => {
          const primary = String(a.role || '').toLowerCase();
          const roleNames = Array.isArray(a.roles)
            ? a.roles.map((r: any) => String(r.name || r.id || '').toLowerCase())
            : [];
          return primary.includes(roleFilter) || roleNames.some((r: string) => r.includes(roleFilter));
        });
      }

      // Apply capability filter: match any entry in agent.capabilities array
      if (capabilityFilter) {
        list = list.filter((a: any) => {
          const caps: string[] = Array.isArray(a.capabilities)
            ? a.capabilities.map((c: any) => String(c).toLowerCase())
            : [];
          return caps.some((c) => c.includes(capabilityFilter));
        });
      }

      return {
        agents: limit ? list.slice(0, limit) : list,
        total: list.length,
        filters: { role: roleFilter || null, capability: capabilityFilter || null },
      };
    },
  });

  registerTool({
    name: 'agents.get',
    domain: 'agents',
    description: 'Get a single agent by tokenId (ERC-8004 NFT ID).',
    authRequired: false,
    roles: [],
    inputSchema: [{ name: 'tokenId', type: 'string', required: true, description: 'ERC-8004 NFT token ID.' }],
    legacyAliases: ['get_agent'],
    kind: 'read',
    handler: async (args) => {
      const id = String(args.tokenId || '').trim();
      if (!id) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'tokenId required');
      const res = await fetch(indexerUrl(`/agents/${encodeURIComponent(id)}`), { cache: 'no-store' });
      if (!res.ok) throw new McpError(MCP_ERRORS.NOT_FOUND, `agent not found (indexer ${res.status})`);
      return res.json();
    },
  });

  // ── READ: jobs ───────────────────────────────────────────────────────────

  registerTool({
    name: 'jobs.list_public',
    domain: 'jobs',
    description: 'List jobs from the indexer. Supports optional status filter.',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'status', type: 'string', description: 'created | funded | submitted | completed' },
      { name: 'limit', type: 'number', description: 'Optional max count (1-50).' },
    ],
    legacyAliases: ['list_jobs'],
    kind: 'read',
    handler: async (args) => {
      const status = typeof args.status === 'string' ? args.status.toLowerCase() : undefined;
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, args.limit)) : undefined;
      const res = await fetch(indexerUrl('/jobs'), { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      let list: unknown[] = Array.isArray(json) ? json : json.jobs || json.data || [];
      if (status) list = list.filter((j: any) => String(j.status || '').toLowerCase().includes(status));
      return { jobs: limit ? list.slice(0, limit) : list, total: list.length };
    },
  });

  registerTool({
    name: 'jobs.get_public',
    domain: 'jobs',
    description: 'Get a single job by jobId.',
    authRequired: false,
    roles: [],
    inputSchema: [{ name: 'jobId', type: 'string', required: true, description: 'Job ID.' }],
    legacyAliases: ['get_job'],
    kind: 'read',
    handler: async (args) => {
      const id = String(args.jobId || '').trim();
      if (!id) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
      const res = await fetch(indexerUrl(`/jobs/${encodeURIComponent(id)}`), { cache: 'no-store' });
      if (!res.ok) throw new McpError(MCP_ERRORS.NOT_FOUND, `job not found (indexer ${res.status})`);
      return res.json();
    },
  });

  // ── READ: docs ───────────────────────────────────────────────────────────

  registerTool({
    name: 'docs.arc_search',
    domain: 'docs',
    description: 'Search Arc Network documentation by scanning https://docs.arc.io/llms.txt.',
    authRequired: false,
    roles: [],
    inputSchema: [{ name: 'query', type: 'string', required: true, description: 'Search query for Arc docs.' }],
    legacyAliases: ['arc_docs_search'],
    kind: 'read',
    handler: async (args) => {
      const query = String(args.query || '').trim();
      if (!query) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'query required');
      const res = await fetch('https://docs.arc.io/llms.txt', { cache: 'no-store' });
      if (!res.ok) return { error: `fetch failed: ${res.status}`, fallback: 'https://docs.arc.io' };
      const text = await res.text();
      const lines = text.split('\n');
      const matches = lines.filter((l) => l.toLowerCase().includes(query.toLowerCase()));
      return {
        source: 'https://docs.arc.io/llms.txt',
        query,
        results: matches.slice(0, 20),
        totalMatches: matches.length,
        fullDocsUrl: 'https://docs.arc.io',
        mcpServer: 'https://docs.arc.io/mcp',
      };
    },
  });

  // ── TX INSTRUCTION: identity / ERC-8004 registration ─────────────────────

  registerTool({
    name: 'identity.prepare_register_agent',
    domain: 'identity',
    description:
      'Build unsigned calldata for ERC-8004 IdentityRegistry.register(metadataURI). Returns tx instructions; the caller signs and sends.',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'metadataURI', type: 'string', required: true, description: 'Public agent manifest URL (HTTPS or IPFS).' },
    ],
    legacyAliases: ['register_agent_calldata'],
    kind: 'tx_instruction',
    handler: async (args) => {
      const metadataURI = String(args.metadataURI || '').trim();
      if (!metadataURI) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'metadataURI required');
      const data = encodeFunctionData({
        abi: ERC8004_IDENTITY_REGISTRY_ABI as any,
        functionName: 'register',
        args: [metadataURI],
      });
      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
        data,
        value: '0x0',
        signingRequired: true,
        signing: {
          how: 'Send this transaction from your controller wallet on Arc Testnet (chainId 5042002).',
          rpc: ARC_RPC,
          gasHint: '~200000',
        },
        notes: [
          'tokenId is emitted in the Transfer(from=0x0, to, tokenId) event in the tx receipt.',
          'metadataURI should point to a public agent manifest (e.g. /.well-known/agent.json).',
          'ArcLayer never holds your private key. Sign + broadcast yourself.',
        ],
      };
    },
  });

  // ── TX INSTRUCTION: reputation / feedback ─────────────────────────────────

  registerTool({
    name: 'reputation.give_feedback',
    domain: 'reputation',
    description: 'Build unsigned calldata for ERC-8004 ReputationRegistry.giveFeedback(...).',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'agentTokenId', type: 'string', required: true },
      { name: 'score', type: 'string', required: true },
      { name: 'category', type: 'string', required: true },
      { name: 'comment', type: 'string', required: true },
      { name: 'metadataURI', type: 'string', required: true },
      { name: 'proofURI', type: 'string', required: true },
      { name: 'context', type: 'string', required: true },
      { name: 'ref', type: 'string', required: true },
    ],
    legacyAliases: ['give_feedback_calldata'],
    kind: 'tx_instruction',
    handler: async (args) => {
      const data = encodeFunctionData({
        abi: ERC8004_REPUTATION_REGISTRY_ABI as any,
        functionName: 'giveFeedback',
        args: [
          BigInt(String(args.agentTokenId || '').trim()),
          BigInt(String(args.score || '').trim()),
          Number(String(args.category || '').trim()),
          String(args.comment || '').trim(),
          String(args.metadataURI || '').trim(),
          String(args.proofURI || '').trim(),
          String(args.context || '').trim(),
          String(args.ref || '').trim(),
        ],
      });
      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.ERC8004_REPUTATION_REGISTRY,
        data,
        value: '0x0',
        signingRequired: true,
        signing: { how: 'Send from the feedback author wallet on Arc Testnet.', rpc: ARC_RPC },
      };
    },
  });

  // ── TX INSTRUCTION: validation ────────────────────────────────────────────

  registerTool({
    name: 'validation.request_calldata',
    domain: 'validation',
    description: 'Build unsigned calldata for ERC-8004 ValidationRegistry.validationRequest(...).',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'validator', type: 'string', required: true },
      { name: 'agentTokenId', type: 'string', required: true },
      { name: 'taskUri', type: 'string', required: true },
      { name: 'requestHash', type: 'string', required: true },
    ],
    legacyAliases: ['validation_request_calldata'],
    kind: 'tx_instruction',
    handler: async (args) => {
      const data = encodeFunctionData({
        abi: ERC8004_VALIDATION_REGISTRY_ABI as any,
        functionName: 'validationRequest',
        args: [
          String(args.validator || '').trim() as Hex,
          BigInt(String(args.agentTokenId || '').trim()),
          String(args.taskUri || '').trim(),
          String(args.requestHash || '').trim() as Hex,
        ],
      });
      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.ERC8004_VALIDATION_REGISTRY,
        data,
        value: '0x0',
        signingRequired: true,
        signing: { how: 'Send from requester/controller wallet on Arc Testnet.', rpc: ARC_RPC },
      };
    },
  });

  registerTool({
    name: 'validation.response_calldata',
    domain: 'validation',
    description: 'Build unsigned calldata for ERC-8004 ValidationRegistry.validationResponse(...).',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'requestHash', type: 'string', required: true },
      { name: 'status', type: 'string', required: true },
      { name: 'resultUri', type: 'string', required: true },
      { name: 'resultHash', type: 'string', required: true },
      { name: 'reason', type: 'string', required: true },
    ],
    legacyAliases: ['validation_response_calldata'],
    kind: 'tx_instruction',
    handler: async (args) => {
      const data = encodeFunctionData({
        abi: ERC8004_VALIDATION_REGISTRY_ABI as any,
        functionName: 'validationResponse',
        args: [
          String(args.requestHash || '').trim() as Hex,
          Number(String(args.status || '').trim()),
          String(args.resultUri || '').trim(),
          String(args.resultHash || '').trim() as Hex,
          String(args.reason || '').trim(),
        ],
      });
      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.ERC8004_VALIDATION_REGISTRY,
        data,
        value: '0x0',
        signingRequired: true,
        signing: { how: 'Send from assigned validator wallet on Arc Testnet.', rpc: ARC_RPC },
      };
    },
  });

  registerTool({
    name: 'validation.status_read',
    domain: 'validation',
    description: 'Read helper for ValidationRegistry.getValidationStatus([requestHash]).',
    authRequired: false,
    roles: [],
    inputSchema: [{ name: 'requestHash', type: 'string', required: true }],
    legacyAliases: ['validation_status_read'],
    kind: 'read',
    handler: async (args) => ({
      method: 'getValidationStatus',
      contract: CONTRACTS.ERC8004_VALIDATION_REGISTRY,
      abiFunction: 'getValidationStatus(bytes32 requestHash)',
      note: 'Use your own Arc Testnet RPC client to call this read method.',
      args: [String(args.requestHash || '').trim()],
    }),
  });

  // ── TX INSTRUCTION: ERC-8183 job lifecycle ────────────────────────────────

  registerTool({
    name: 'client.prepare_create_job',
    domain: 'jobs',
    description:
      'Build unsigned calldata for ERC-8183 AgenticCommerce.createJob(provider, evaluator, expiredAt, description, hook).',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'provider', type: 'string', required: true, description: 'Provider/worker wallet address.' },
      { name: 'evaluator', type: 'string', required: true, description: 'Evaluator wallet address.' },
      { name: 'expiredAt', type: 'string', required: true, description: 'Unix timestamp when job expires.' },
      { name: 'description', type: 'string', required: true, description: 'Job description string.' },
      { name: 'hook', type: 'string', description: 'Optional hook contract address (default: 0x0).' },
    ],
    legacyAliases: ['create_job_calldata'],
    kind: 'tx_instruction',
    handler: async (args) => {
      const provider = String(args.provider || '').trim();
      const evaluator = String(args.evaluator || '').trim();
      const expiredAt = String(args.expiredAt || '').trim();
      const description = String(args.description || '').trim();
      const hook = String(args.hook || '0x0000000000000000000000000000000000000000').trim();
      if (!provider || !evaluator || !expiredAt || !description) {
        throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'provider, evaluator, expiredAt, description required');
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(provider)) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'provider is not a valid address');
      if (!/^0x[a-fA-F0-9]{40}$/.test(evaluator)) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'evaluator is not a valid address');
      const data = encodeFunctionData({
        abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
        functionName: 'createJob',
        args: [provider as Hex, evaluator as Hex, BigInt(expiredAt), description, hook as Hex],
      });
      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        data,
        value: '0x0',
        signingRequired: true,
        signing: { how: 'Send from the client wallet on Arc Testnet.', rpc: ARC_RPC, gasHint: '~300000' },
        lifecycle: [
          '1. createJob → get jobId from JobCreated event',
          '2. provider calls setBudget(jobId, amount, "0x")',
          '3. USDC.approve(AgenticCommerce, amount)',
          '4. fund(jobId, "0x")',
          '5. submit(jobId, deliverableHash, "0x")',
          '6. complete(jobId, reasonHash, "0x")',
        ],
      };
    },
  });

  registerTool({
    name: 'provider.prepare_set_budget',
    domain: 'jobs',
    description: 'Build unsigned calldata for ERC-8183 AgenticCommerce.setBudget(jobId, amount, optParams).',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'amount', type: 'string', required: true, description: 'Budget in USDC atomic units (6 decimals).' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    legacyAliases: ['set_budget_calldata'],
    kind: 'tx_instruction',
    handler: async (args) => {
      const jobIdRaw = String(args.jobId || '').trim();
      const amountRaw = String(args.amount || '').trim();
      const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;
      if (!jobIdRaw || !amountRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId, amount required');
      const data = encodeFunctionData({
        abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
        functionName: 'setBudget',
        args: [BigInt(jobIdRaw), BigInt(amountRaw), optParams],
      });
      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        data,
        value: '0x0',
        signingRequired: true,
        derived: { jobId: jobIdRaw, budgetAtomic: amountRaw, budgetUsdc: `${Number(amountRaw) / 1e6} USDC` },
        signing: { how: 'Send from the provider wallet assigned to this job.', rpc: ARC_RPC, gasHint: '~80000' },
      };
    },
  });

  registerTool({
    name: 'client.prepare_approve_usdc',
    domain: 'jobs',
    description: 'Build unsigned calldata for USDC.approve(AgenticCommerce, amount). Must be called before fund().',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'amount', type: 'string', required: true, description: 'Amount in USDC atomic units (6 decimals).' },
    ],
    legacyAliases: ['approve_usdc_calldata'],
    kind: 'tx_instruction',
    handler: async (args) => {
      const amountRaw = String(args.amount || '').trim();
      if (!amountRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'amount required');
      const data = encodeFunctionData({
        abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }] as any,
        functionName: 'approve',
        args: [CONTRACTS.ERC8183_AGENTIC_COMMERCE as Hex, BigInt(amountRaw)],
      });
      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.USDC,
        data,
        value: '0x0',
        signingRequired: true,
        derived: { spender: CONTRACTS.ERC8183_AGENTIC_COMMERCE, amountAtomic: amountRaw, amountUsdc: `${Number(amountRaw) / 1e6} USDC` },
        signing: { how: 'Send from the client wallet that holds USDC.', rpc: ARC_RPC, gasHint: '~50000' },
      };
    },
  });

  registerTool({
    name: 'client.prepare_fund_job',
    domain: 'jobs',
    description: 'Build unsigned calldata for ERC-8183 AgenticCommerce.fund(jobId, optParams).',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    legacyAliases: ['fund_job_calldata'],
    kind: 'tx_instruction',
    handler: async (args) => {
      const jobIdRaw = String(args.jobId || '').trim();
      const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;
      if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
      const data = encodeFunctionData({
        abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
        functionName: 'fund',
        args: [BigInt(jobIdRaw), optParams],
      });
      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        data,
        value: '0x0',
        signingRequired: true,
        signing: { how: 'Send from the client wallet. USDC.approve must have been called first.', rpc: ARC_RPC, gasHint: '~120000' },
        prerequisites: ['Call provider.prepare_set_budget first.', 'Call client.prepare_approve_usdc to approve escrow.'],
      };
    },
  });

  registerTool({
    name: 'provider.prepare_submit_job',
    domain: 'jobs',
    description: 'Build unsigned calldata for ERC-8183 AgenticCommerce.submit(jobId, deliverableHash, optParams).',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'deliverableHash', type: 'string', required: true, description: 'Keccak256 hash of the deliverable content.' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    legacyAliases: ['submit_job_calldata'],
    kind: 'tx_instruction',
    handler: async (args) => {
      const jobIdRaw = String(args.jobId || '').trim();
      const deliverableHash = String(args.deliverableHash || '').trim();
      const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;
      if (!jobIdRaw || !deliverableHash) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId, deliverableHash required');
      const data = encodeFunctionData({
        abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
        functionName: 'submit',
        args: [BigInt(jobIdRaw), deliverableHash as Hex, optParams],
      });
      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        data,
        value: '0x0',
        signingRequired: true,
        signing: { how: 'Send from the provider wallet assigned to this job.', rpc: ARC_RPC, gasHint: '~200000' },
        invariants: ['Only the designated provider can submit.', 'Job must be in funded state.'],
      };
    },
  });

  registerTool({
    name: 'evaluator.prepare_complete_job',
    domain: 'jobs',
    description: 'Build unsigned calldata for ERC-8183 AgenticCommerce.complete(jobId, reason, optParams).',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'reason', type: 'string', description: 'Reason string (will be keccak256-hashed) OR a 0x-prefixed 32-byte hash.' },
      { name: 'reasonHash', type: 'string', description: 'Optional pre-computed bytes32 reason hash; takes precedence.' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    legacyAliases: ['complete_job_calldata'],
    kind: 'tx_instruction',
    handler: async (args) => {
      const jobIdRaw = String(args.jobId || '').trim();
      if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
      const reasonHashRaw = String(args.reasonHash || '').trim();
      const reasonRaw = String(args.reason || '').trim();
      const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;
      let resolvedReason: Hex;
      if (reasonHashRaw) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(reasonHashRaw)) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'reasonHash must be 0x-prefixed 32-byte hex');
        resolvedReason = reasonHashRaw as Hex;
      } else if (reasonRaw) {
        resolvedReason = (reasonRaw.startsWith('0x') && reasonRaw.length === 66 ? reasonRaw : keccak256(toBytes(reasonRaw))) as Hex;
      } else {
        resolvedReason = keccak256(toBytes('approved')) as Hex;
      }
      const data = encodeFunctionData({
        abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
        functionName: 'complete',
        args: [BigInt(jobIdRaw), resolvedReason, optParams],
      });
      return {
        chainId: ARC_CHAIN_ID,
        to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        data,
        value: '0x0',
        signingRequired: true,
        signing: { how: 'Send from the evaluator wallet. Releases escrowed USDC to provider.', rpc: ARC_RPC, gasHint: '~150000' },
        invariants: ['Only the evaluator can call complete.', 'Job must have a submitted deliverable.'],
      };
    },
  });

  // ── READ: ERC-8183 on-chain status ───────────────────────────────────────

  registerTool({
    name: 'jobs.get_onchain_status',
    domain: 'jobs',
    description:
      'Read on-chain ERC-8183 job state via AgenticCommerce.getJob(). Falls back to indexer if contract read fails.',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: (args) => handleJobsGetOnchainStatus(args),
  });

  registerTool({
    name: 'jobs.get_lifecycle_summary',
    domain: 'jobs',
    description:
      'Compute next actor/action for an ERC-8183 job based on on-chain state. Supports both direct hire and open/global flows.',
    authRequired: false,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: (args) => handleJobsGetLifecycleSummary(args),
  });

  // ── SESSION-AWARE: ERC-8183 lifecycle prepare ────────────────────────────

  registerTool({
    name: 'client.prepare_create_job_for_session',
    domain: 'jobs',
    description:
      'Build unsigned calldata for AgenticCommerce.createJob (direct hire flow). Provider is required and non-zero. Requires MCP Bearer session.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'provider', type: 'string', required: true, description: 'Provider/worker wallet address (non-zero).' },
      { name: 'evaluator', type: 'string', description: 'Evaluator wallet address. Defaults to session owner for self-evaluation.' },
      { name: 'description', type: 'string', required: true, description: 'Job description (max 2048 chars).' },
      { name: 'deadlineMinutes', type: 'number', description: 'Minutes until job expires (15-43200, default 1440).' },
      { name: 'hook', type: 'string', description: 'Optional hook contract address (default: 0x0).' },
    ],
    legacyAliases: [],
    kind: 'tx_instruction',
    handler: (args, ctx) => handleClientPrepareCreateJobForSession(args, ctx),
  });

  registerTool({
    name: 'client.prepare_create_open_job_for_session',
    domain: 'jobs',
    description:
      'Build unsigned calldata for AgenticCommerce.createJob with provider=address(0) (open/global job board flow). Provider must be assigned later via setProvider. Requires MCP Bearer session.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'evaluator', type: 'string', description: 'Evaluator wallet address. Defaults to session owner for self-evaluation.' },
      { name: 'description', type: 'string', required: true, description: 'Job description (max 2048 chars).' },
      { name: 'deadlineMinutes', type: 'number', description: 'Minutes until job expires (15-43200, default 1440).' },
      { name: 'hook', type: 'string', description: 'Optional hook contract address (default: 0x0).' },
    ],
    legacyAliases: [],
    kind: 'tx_instruction',
    handler: (args, ctx) => handleClientPrepareCreateOpenJobForSession(args, ctx),
  });

  registerTool({
    name: 'client.prepare_set_provider_for_session',
    domain: 'jobs',
    description:
      'Build unsigned calldata for AgenticCommerce.setProvider(jobId, provider). Assigns/hires a provider for an open job created with provider=address(0). Verified 2-arg on-chain signature. Requires MCP Bearer session.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'provider', type: 'string', required: true, description: 'Provider/worker wallet address (non-zero).' },
    ],
    legacyAliases: [],
    kind: 'tx_instruction',
    handler: (args, ctx) => handleClientPrepareSetProviderForSession(args, ctx),
  });

  registerTool({
    name: 'provider.prepare_set_budget_for_session',
    domain: 'jobs',
    description:
      'Build unsigned calldata for AgenticCommerce.setBudget(jobId, amount, optParams). Current Arc Testnet deployment requires the assigned provider to call this while the job is Open. Requires MCP Bearer session.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'amountAtomic', type: 'string', description: 'Budget in USDC atomic units (6 decimals).' },
      { name: 'amountUsdc', type: 'string', description: 'Budget in USDC (e.g. "1.5"). Converted to 6-decimal atomic.' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    legacyAliases: [],
    kind: 'tx_instruction',
    handler: (args, ctx) => handleProviderPrepareSetBudgetForSession(args, ctx),
  });

  registerTool({
    name: 'client.prepare_fund_job_bundle_for_session',
    domain: 'jobs',
    description:
      'Build ordered unsigned txs for USDC approve + AgenticCommerce.fund(jobId, optParams). Checks USDC allowance if clientAddress is provided; returns fund-only if sufficient. Requires MCP Bearer session.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'amountAtomic', type: 'string', description: 'Fund amount in USDC atomic units. If omitted, reads budget from on-chain.' },
      { name: 'amountUsdc', type: 'string', description: 'Fund amount in USDC (e.g. "1.5").' },
      { name: 'clientAddress', type: 'string', description: 'Client wallet address for allowance check.' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload for fund (default "0x").' },
    ],
    legacyAliases: [],
    kind: 'tx_instruction',
    handler: (args, ctx) => handleClientPrepareFundJobBundleForSession(args, ctx),
  });

  registerTool({
    name: 'provider.prepare_submit_job_for_session',
    domain: 'jobs',
    description:
      'Build unsigned calldata for AgenticCommerce.submit(jobId, deliverableHash, optParams). Requires MCP Bearer session.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'deliverableHash', type: 'string', description: 'Keccak256 hash of the deliverable (0x-prefixed 32-byte hex).' },
      { name: 'deliverable', type: 'string', description: 'Deliverable content string (will be keccak256-hashed).' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    legacyAliases: [],
    kind: 'tx_instruction',
    handler: (args, ctx) => handleProviderPrepareSubmitJobForSession(args, ctx),
  });

  registerTool({
    name: 'evaluator.prepare_complete_job_for_session',
    domain: 'jobs',
    description:
      'Build unsigned calldata for AgenticCommerce.complete(jobId, reasonHash, optParams). Releases escrowed USDC to provider. Requires MCP Bearer session.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'reason', type: 'string', description: 'Reason string (will be keccak256-hashed). Default: "approved".' },
      { name: 'reasonHash', type: 'string', description: 'Pre-computed bytes32 reason hash (takes precedence).' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    legacyAliases: [],
    kind: 'tx_instruction',
    handler: (args, ctx) => handleEvaluatorPrepareCompleteJobForSession(args, ctx),
  });

  registerTool({
    name: 'client.prepare_reject_job_for_session',
    domain: 'jobs',
    description:
      'Build unsigned calldata for AgenticCommerce.reject(jobId, reasonHash, optParams). Client rejects/cancels an Open job before funding. Requires MCP Bearer session.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'reason', type: 'string', description: 'Reason string (will be keccak256-hashed). Default: "client_rejected".' },
      { name: 'reasonHash', type: 'string', description: 'Pre-computed bytes32 reason hash (takes precedence).' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    legacyAliases: [],
    kind: 'tx_instruction',
    handler: (args, ctx) => handleClientPrepareRejectJobForSession(args, ctx),
  });

  registerTool({
    name: 'evaluator.prepare_reject_job_for_session',
    domain: 'jobs',
    description:
      'Build unsigned calldata for AgenticCommerce.reject(jobId, reasonHash, optParams). Evaluator rejects a Funded or Submitted job. If escrow exists, funds are refunded to client. Requires MCP Bearer session.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
      { name: 'reason', type: 'string', description: 'Reason string (will be keccak256-hashed). Default: "rejected".' },
      { name: 'reasonHash', type: 'string', description: 'Pre-computed bytes32 reason hash (takes precedence).' },
      { name: 'optParams', type: 'string', description: 'Optional bytes payload (default "0x").' },
    ],
    legacyAliases: [],
    kind: 'tx_instruction',
    handler: (args, ctx) => handleEvaluatorPrepareRejectJobForSession(args, ctx),
  });

  registerTool({
    name: 'client.prepare_claim_refund_for_session',
    domain: 'jobs',
    description:
      'Build unsigned calldata for AgenticCommerce.claimRefund(jobId). Returns escrow to client after job expiry. Signature: claimRefund(uint256 jobId) — no optParams. Requires MCP Bearer session.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'jobId', type: 'string', required: true, description: 'Job ID (uint256).' },
    ],
    legacyAliases: [],
    kind: 'tx_instruction',
    handler: (args, ctx) => handleClientPrepareClaimRefundForSession(args, ctx),
  });

  // ── READ: identity / agent account ────────────────────────────────────────

  registerTool({
    name: 'identity.get_agent_account',
    domain: 'identity',
    description:
      'Get the agent account (Circle Smart Account) bound to the authenticated MCP session. Returns owner and agent account addresses.',
    authRequired: true,
    roles: [],
    inputSchema: [],
    legacyAliases: [],
    kind: 'read',
    handler: handleGetAgentAccount,
  });

  registerTool({
    name: 'identity.prepare_register_agent_for_session',
    domain: 'identity',
    description:
      'Validate agent metadata and build encoded calldata for ERC-8004 IdentityRegistry.register(metadataURI). Authenticated — requires MCP Bearer token. Does NOT create approval or execute tx.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'name', type: 'string', required: true, description: 'Agent name (max 128 chars).' },
      { name: 'role', type: 'string', required: true, description: 'Agent role: provider, client, evaluator, agent, oracle, analyzer, executor, worker, buyer, settler.' },
      { name: 'capabilities', type: 'array', required: true, description: 'Array of capability strings (non-empty, max 20).' },
      { name: 'description', type: 'string', required: true, description: 'Agent description (max 1024 chars).' },
      { name: 'endpoint', type: 'string', description: 'Optional endpoint URL.' },
    ],
    legacyAliases: [],
    kind: 'tx_instruction',
    handler: handlePrepareRegisterAgent,
  });

  registerTool({
    name: 'identity.request_register_agent_approval',
    domain: 'identity',
    description:
      'Prepare + create approval for ERC-8004 identity registration in one call. Validates metadata, builds calldata, creates approval via approval engine. Returns approval ID for tracking.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'name', type: 'string', required: true, description: 'Agent name (max 128 chars).' },
      { name: 'role', type: 'string', required: true, description: 'Agent role: provider, client, evaluator, agent, oracle, analyzer, executor, worker, buyer, settler.' },
      { name: 'capabilities', type: 'array', required: true, description: 'Array of capability strings (non-empty, max 20).' },
      { name: 'description', type: 'string', required: true, description: 'Agent description (max 1024 chars).' },
      { name: 'endpoint', type: 'string', description: 'Optional endpoint URL.' },
    ],
    legacyAliases: ['register_agent_approval'],
    kind: 'tx_instruction',
    handler: handleRequestRegisterAgentApproval,
  });

  registerTool({
    name: 'identity.get_registration_status',
    domain: 'identity',
    description:
      'Get the status of an identity registration approval. Returns approval status, addresses, timestamps, and summary.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'approvalId', type: 'string', required: true, description: 'Approval ID from request_register_agent_approval.' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleGetRegistrationStatus,
  });

  // ── AUTH: API key management ─────────────────────────────────────────────

  registerTool({
    name: 'provider.create_api_key',
    domain: 'provider',
    description:
      'Create an API key for a registered agent. Preset "provider" or "client". Returns raw key ONCE. Requires MCP Bearer token and agent ownership.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Agent ID or token ID.' },
      { name: 'preset', type: 'string', description: 'Key preset: "provider" (default) or "client".' },
      { name: 'label', type: 'string', description: 'Optional human-readable label (max 80 chars).' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleCreateApiKey,
  });

  registerTool({
    name: 'provider.list_api_keys',
    domain: 'provider',
    description:
      'List API key metadata for an agent. Returns id, prefix, label, scopes, status. Never returns raw key or hash. Requires MCP Bearer token and agent ownership.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Agent ID or token ID.' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleListApiKeys,
  });

  registerTool({
    name: 'provider.revoke_api_key',
    domain: 'provider',
    description:
      'Revoke an API key by ID. Requires MCP Bearer token and agent ownership.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Agent ID or token ID.' },
      { name: 'keyId', type: 'string', required: true, description: 'API key ID to revoke.' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleRevokeApiKey,
  });

  // ── Provider Runtime Tools (PR #461) ───────────────────────────────────────

  registerTool({
    name: 'provider.runtime_get_context',
    domain: 'provider',
    description:
      'Get provider runtime context: state, active run, latest checkpoint, active applications, resume plan.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Provider agent ID.' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleProviderRuntimeGetContext,
  });

  registerTool({
    name: 'provider.runtime_heartbeat',
    domain: 'provider',
    description: 'Update provider last_seen_at. Creates runtime state if missing.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Provider agent ID.' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleProviderRuntimeHeartbeat,
  });

  registerTool({
    name: 'provider.runtime_start_job',
    domain: 'provider',
    description:
      'Start a new job run or return existing active run. Idempotent on provider:agentId:job:jobId.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Provider agent ID.' },
      { name: 'jobId', type: 'string', required: true, description: 'ERC-8183 job ID.' },
      { name: 'phase', type: 'string', description: 'Initial phase (default: budget_tx_sent).' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleProviderRuntimeStartJob,
  });

  registerTool({
    name: 'provider.runtime_write_checkpoint',
    domain: 'provider',
    description: 'Write an append-only checkpoint for a job run.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Provider agent ID.' },
      { name: 'jobId', type: 'string', required: true, description: 'ERC-8183 job ID.' },
      { name: 'runId', type: 'string', description: 'Run ID (auto-resolved if omitted).' },
      { name: 'phase', type: 'string', required: true, description: 'Checkpoint phase.' },
      { name: 'status', type: 'string', required: true, description: 'Checkpoint status.' },
      { name: 'txHash', type: 'string', description: 'Transaction hash (if applicable).' },
      { name: 'deliverableHash', type: 'string', description: 'Deliverable hash (if applicable).' },
      { name: 'payloadHash', type: 'string', description: 'Payload hash (if applicable).' },
      { name: 'note', type: 'string', description: 'Human-readable note.' },
      { name: 'metadata', type: 'object', description: 'Additional metadata.' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleProviderRuntimeWriteCheckpoint,
  });

  registerTool({
    name: 'provider.runtime_get_resume_plan',
    domain: 'provider',
    description: 'Compute next provider action from checkpoint + on-chain state.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Provider agent ID.' },
      { name: 'jobId', type: 'string', description: 'Specific job ID (optional, uses active run if omitted).' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleProviderRuntimeGetResumePlan,
  });

  registerTool({
    name: 'provider.list_open_jobs',
    domain: 'provider',
    description:
      'List open/global jobs where provider = address(0). Server-side filtered, bounded pagination.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Provider agent ID.' },
      { name: 'limit', type: 'number', description: 'Max results (1-50, default 20).' },
      { name: 'minBudgetUsdc', type: 'string', description: 'Minimum budget in USDC.' },
      { name: 'includeExpired', type: 'boolean', description: 'Include expired jobs (default false).' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleProviderListOpenJobs,
  });

  registerTool({
    name: 'provider.apply_open_job',
    domain: 'provider',
    description:
      'Apply to an open/global job. Provider bot must NOT call setProvider — client assigns onchain.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Provider agent ID.' },
      { name: 'jobId', type: 'string', required: true, description: 'ERC-8183 job ID.' },
      { name: 'providerAddress', type: 'string', required: true, description: 'Provider wallet address.' },
      { name: 'quoteAmountUsdc', type: 'string', description: 'Quote amount in USDC (e.g. "1.5").' },
      { name: 'quoteAmountAtomic', type: 'string', description: 'Quote amount in atomic units (6 decimals).' },
      { name: 'message', type: 'string', description: 'Application message.' },
      { name: 'capabilities', type: 'object', description: 'Provider capabilities array.' },
      { name: 'metadata', type: 'object', description: 'Additional metadata.' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleProviderApplyOpenJob,
  });

  registerTool({
    name: 'provider.withdraw_open_job_application',
    domain: 'provider',
    description: 'Withdraw an open job application.',
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Provider agent ID.' },
      { name: 'jobId', type: 'string', required: true, description: 'ERC-8183 job ID.' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleProviderWithdrawOpenJobApplication,
  });

  registerTool({
    name: 'provider.list_my_open_job_applications',
    domain: 'provider',
    description: "List provider's open job applications.",
    authRequired: true,
    roles: [],
    inputSchema: [
      { name: 'agentId', type: 'string', required: true, description: 'Provider agent ID.' },
      { name: 'status', type: 'string', description: 'Filter by status (submitted, withdrawn, selected, rejected, expired).' },
    ],
    legacyAliases: [],
    kind: 'read',
    handler: handleProviderListMyOpenJobApplications,
  });
}

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
      rpc: ARC_RPC,
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
      kind: t.kind,
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
      const toolsList = listTools().map(toMcpToolSchema);
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

    // Legacy method fallback: treat method as a tool name/alias
    if (hasTool(method)) {
      try {
        const result = await invokeTool(method, params, mcpCtx);
        return { json: jsonRpcResult(id, { tool: method, kind: getTool(method)?.kind, result }), status: 200 };
      } catch (e) {
        const mcpErr = thrownToMcpError(e);
        return { json: jsonRpcError(id, mcpErr.code, redactString(mcpErr.message)), status: mcpErr.status };
      }
    }

    // Unknown method
    return { json: jsonRpcError(id, MCP_ERRORS.UNKNOWN_METHOD, `Unknown method: ${method}`), status: 400 };
  }

  // ── Simple shape: { tool, args } ───────────────────────────────────────
  if (typeof b.tool === 'string') {
    const toolArgs = (b.args && typeof b.args === 'object' ? b.args : {}) as Record<string, unknown>;
    try {
      const result = await invokeTool(b.tool, toolArgs, mcpCtx);
      return { json: { tool: b.tool, kind: getTool(b.tool)?.kind, result }, status: 200 };
    } catch (e) {
      const mcpErr = thrownToMcpError(e);
      return { json: { tool: b.tool, error: redactString(mcpErr.message) }, status: mcpErr.status };
    }
  }

  return { json: jsonRpcError(id, MCP_ERRORS.INVALID_REQUEST, 'Provide { tool, args } or { jsonrpc, method, params }'), status: 400 };
}

// ─── HANDLE GET ──────────────────────────────────────────────────────────────

export async function handleMcpGet(
  searchParams: URLSearchParams,
  ctx: RequestContext,
): Promise<unknown> {
  registerAllTools();
  const toolName = searchParams.get('tool');
  const mcpCtx: McpToolContext = { request: ctx };

  // GET without tool → manifest
  if (!toolName) {
    return buildManifest(ctx);
  }

  // GET with tool → invoke
  const args: Record<string, unknown> = {};
  searchParams.forEach((v, k) => {
    if (k !== 'tool') args[k] = v;
  });

  try {
    const result = await invokeTool(toolName, args, mcpCtx);
    return { tool: toolName, kind: getTool(toolName)?.kind, result };
  } catch (e) {
    const mcpErr = thrownToMcpError(e);
    return { tool: toolName, error: redactString(mcpErr.message) };
  }
}
