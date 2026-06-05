/**
 * MCP Provider Runtime Tools — Durable runtime memory + open job discovery.
 *
 * PR #461: Tools for provider PM2 bots to persist state, resume jobs,
 * discover/apply to open/global jobs, and track phase transitions.
 *
 * Auth: MCP Bearer session required (arc_mcp_sess_*).
 * Ownership: Reuses resolveAgentOwnership() from api-key-tools.ts.
 * Security: validateAgentId() at every boundary, no .or() injection.
 */

import type { McpToolContext } from './registry';
import { MCP_ERRORS, McpError } from './errors';
import { resolveMcpSessionByToken } from '@/lib/agent-accounts/store';
import type { McpSession } from '@/lib/agent-accounts/types';
import { jsonSafe } from './erc8183-tools';
import {
  getProviderRuntimeContext,
  heartbeatProvider,
  startProviderJobRun,
  writeProviderCheckpoint,
  completeProviderJobRun,
  failProviderJobRun,
  getProviderResumePlan,
  listOpenGlobalJobs,
  listAssignedJobs,
  applyToOpenJob,
  withdrawOpenJobApplication,
  listProviderApplications,
  PROVIDER_PHASES,
  type ProviderAuthContext,
  type ProviderPhase,
} from '@/lib/provider-runtime/store';

// ── Session Auth ──────────────────────────────────────────────────────────

/**
 * Extract and validate MCP session from tool context.
 * Throws McpError if not authenticated.
 */
async function requireMcpSession(ctx: McpToolContext): Promise<McpSession> {
  const auth = ctx.request.authorization;
  if (!auth) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'MCP Bearer token required');
  }

  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1].startsWith('arc_mcp_sess_')) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'Invalid MCP token format');
  }

  const session = await resolveMcpSessionByToken(match[1].trim());
  if (!session) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'Invalid or expired MCP session');
  }

  return session;
}

function buildAuth(session: McpSession, agentId: string): ProviderAuthContext {
  return { session, agentId };
}

// ── Tool Handlers ─────────────────────────────────────────────────────────

/**
 * provider.runtime_get_context
 *
 * Get provider runtime context: state, active run, latest checkpoint,
 * active applications, and resume plan. Focused response — no large history.
 */
export async function handleProviderRuntimeGetContext(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId required');

  const providerAddress = typeof args.providerAddress === 'string' ? args.providerAddress.trim() : undefined;

  const context = await getProviderRuntimeContext(agentId, buildAuth(session, agentId), providerAddress);

  return jsonSafe({
    agentId,
    role: 'provider',
    runtimeState: context.runtimeState,
    activeRun: context.activeRun,
    latestCheckpoint: context.latestCheckpoint,
    activeApplications: context.activeApplications,
    resumePlan: context.resumePlan,
  });
}

/**
 * provider.runtime_heartbeat
 *
 * Update last_seen_at for a provider agent. Creates runtime state if missing.
 */
export async function handleProviderRuntimeHeartbeat(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId required');

  await heartbeatProvider(agentId, buildAuth(session, agentId));

  return { ok: true, agentId, status: 'active' };
}

/**
 * provider.runtime_start_job
 *
 * Start a new job run or return existing active run.
 * Idempotent on provider:<agentId>:job:<jobId>.
 */
export async function handleProviderRuntimeStartJob(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  const jobId = typeof args.jobId === 'string' ? args.jobId.trim() : '';
  const phase = typeof args.phase === 'string' ? args.phase.trim() : 'budget_tx_sent';

  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId required');
  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');

  if (!(PROVIDER_PHASES as readonly string[]).includes(phase)) {
    throw new McpError(
      MCP_ERRORS.VALIDATION_ERROR,
      `Invalid phase. Allowed: ${PROVIDER_PHASES.join(', ')}`,
    );
  }

  const run = await startProviderJobRun(agentId, jobId, phase as ProviderPhase, buildAuth(session, agentId));

  return jsonSafe({
    runId: run.id,
    agentId: run.agent_id,
    jobId: run.job_id,
    runStatus: run.run_status,
    phase: run.phase,
    idempotencyKey: run.idempotency_key,
    startedAt: run.started_at,
  });
}

/**
 * provider.runtime_write_checkpoint
 *
 * Write an append-only checkpoint for a job run.
 * Idempotent on provider:<agentId>:job:<jobId>:checkpoint:<phase>.
 */
export async function handleProviderRuntimeWriteCheckpoint(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  const jobId = typeof args.jobId === 'string' ? args.jobId.trim() : '';
  const phase = typeof args.phase === 'string' ? args.phase.trim() : '';
  const status = typeof args.status === 'string' ? args.status.trim() : '';

  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId required');
  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  if (!phase) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'phase required');
  if (!status) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'status required');

  if (!(PROVIDER_PHASES as readonly string[]).includes(phase)) {
    throw new McpError(
      MCP_ERRORS.VALIDATION_ERROR,
      `Invalid phase. Allowed: ${PROVIDER_PHASES.join(', ')}`,
    );
  }

  const checkpoint = await writeProviderCheckpoint(
    {
      agentId,
      jobId,
      runId: typeof args.runId === 'string' ? args.runId : undefined,
      phase: phase as ProviderPhase,
      status,
      txHash: typeof args.txHash === 'string' ? args.txHash : undefined,
      deliverableHash: typeof args.deliverableHash === 'string' ? args.deliverableHash : undefined,
      payloadHash: typeof args.payloadHash === 'string' ? args.payloadHash : undefined,
      note: typeof args.note === 'string' ? args.note : undefined,
      metadata: typeof args.metadata === 'object' && args.metadata !== null
        ? (args.metadata as Record<string, unknown>)
        : undefined,
    },
    buildAuth(session, agentId),
  );

  return jsonSafe({
    checkpointId: checkpoint.id,
    runId: checkpoint.run_id,
    agentId: checkpoint.agent_id,
    jobId: checkpoint.job_id,
    phase: checkpoint.phase,
    status: checkpoint.status,
    txHash: checkpoint.tx_hash,
    createdAt: checkpoint.created_at,
  });
}

/**
 * provider.runtime_get_resume_plan
 *
 * Compute the next provider action based on checkpoint + on-chain state.
 */
export async function handleProviderRuntimeGetResumePlan(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId required');

  const jobId = typeof args.jobId === 'string' ? args.jobId.trim() : undefined;
  const providerAddress = typeof args.providerAddress === 'string' ? args.providerAddress.trim() : undefined;

  const plan = await getProviderResumePlan(agentId, buildAuth(session, agentId), jobId, providerAddress);

  if (!plan) {
    return jsonSafe({
      agentId,
      hasActiveRun: false,
      resumePlan: null,
    });
  }

  return jsonSafe({
    agentId,
    hasActiveRun: true,
    resumePlan: plan,
  });
}

// ── Open Job Tools ────────────────────────────────────────────────────────

/**
 * provider.list_open_jobs
 *
 * List open/global jobs from the indexer where provider = address(0).
 * Server-side filtering with bounded pagination.
 */
export async function handleProviderListOpenJobs(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId required');

  // Validate agentId ownership (ensures caller controls this agent)
  const { validateAgentId } = await import('@/lib/x402/agent-payer');
  validateAgentId(agentId);

  const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, args.limit)) : 20;
  const minBudgetUsdc = typeof args.minBudgetUsdc === 'string' ? args.minBudgetUsdc : undefined;
  const includeExpired = args.includeExpired === true;

  const jobs = await listOpenGlobalJobs({
    limit,
    minBudgetUsdc,
    includeExpired,
  });

  return jsonSafe({
    jobs,
    total: jobs.length,
    filters: { limit, minBudgetUsdc, includeExpired },
  });
}

/**
 * provider.apply_open_job
 *
 * Apply to an open/global job. Creates or updates application.
 * Provider bot must NOT call setProvider — client assigns onchain.
 */
export async function handleProviderApplyOpenJob(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  const jobId = typeof args.jobId === 'string' ? args.jobId.trim() : '';
  const providerAddress = typeof args.providerAddress === 'string' ? args.providerAddress.trim() : '';

  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId required');
  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  if (!providerAddress) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'providerAddress required');

  const app = await applyToOpenJob(
    {
      agentId,
      jobId,
      providerAddress,
      quoteAmountUsdc: typeof args.quoteAmountUsdc === 'string' ? args.quoteAmountUsdc : undefined,
      quoteAmountAtomic: typeof args.quoteAmountAtomic === 'string' ? args.quoteAmountAtomic : undefined,
      message: typeof args.message === 'string' ? args.message : undefined,
      capabilities: Array.isArray(args.capabilities) ? args.capabilities.map(String) : undefined,
      metadata: typeof args.metadata === 'object' && args.metadata !== null
        ? (args.metadata as Record<string, unknown>)
        : undefined,
    },
    buildAuth(session, agentId),
  );

  return jsonSafe({
    applicationId: app.id,
    jobId: app.job_id,
    providerAgentId: app.provider_agent_id,
    providerAddress: app.provider_address,
    status: app.status,
    quoteAmountAtomic: app.quote_amount_atomic,
    quoteAmountUsdc: app.quote_amount_usdc,
    note: 'Provider application submitted. Client must still assign provider onchain with setProvider.',
  });
}

/**
 * provider.withdraw_open_job_application
 *
 * Withdraw an open job application.
 */
export async function handleProviderWithdrawOpenJobApplication(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  const jobId = typeof args.jobId === 'string' ? args.jobId.trim() : '';

  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId required');
  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');

  await withdrawOpenJobApplication({ agentId, jobId }, buildAuth(session, agentId));

  return { ok: true, agentId, jobId, status: 'withdrawn' };
}

/**
 * provider.list_my_open_job_applications
 *
 * List provider's open job applications.
 */
export async function handleProviderListMyOpenJobApplications(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId required');

  const status = typeof args.status === 'string' ? args.status.trim() : undefined;

  const applications = await listProviderApplications(agentId, buildAuth(session, agentId), status);

  return jsonSafe({
    agentId,
    applications,
    total: applications.length,
  });
}

/**
 * provider.list_assigned_jobs
 *
 * List jobs assigned to a specific provider address (provider = address, status = Open).
 * Used for direct-assigned job discovery.
 */
export async function handleProviderListAssignedJobs(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  const providerAddress = typeof args.providerAddress === 'string' ? args.providerAddress.trim() : '';

  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId required');
  if (!providerAddress) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'providerAddress required');

  // Validate agentId ownership
  const { validateAgentId } = await import('@/lib/x402/agent-payer');
  validateAgentId(agentId);

  const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, args.limit)) : 20;

  const jobs = await listAssignedJobs(providerAddress, limit);

  return jsonSafe({
    agentId,
    providerAddress,
    jobs,
    total: jobs.length,
  });
}
