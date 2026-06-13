/**
 * POST /api/agents/[id]/run
 *
 * x402-protected agent run endpoint.
 * Flow: x402 payment gate → HMAC-signed dispatch to registered runner → store proof/receipt.
 *
 * The x402 gate runs FIRST. Only after payment settles does the dispatch happen.
 * If no runner is registered for the agent, returns a 404 with guidance.
 */
import { createHash, randomUUID } from 'node:crypto';
import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { withX402 } from '@/lib/x402';
import type { AgentX402Rail, AgentX402Scope } from '@/lib/x402/agent-payer';
import { dispatchToRunner } from '@/lib/runner-registry/dispatch';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export const runtime = 'nodejs';

function parseAgentId(req: NextRequest) {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idToken = parts[parts.length - 2];
  const agentId = Number.parseInt(idToken, 10);
  if (!Number.isFinite(agentId) || agentId <= 0) {
    return null;
  }
  return agentId;
}

/**
 * Store proof/receipt after a successful runner dispatch.
 * Inserts into agent_bridge_events (work_proof) and agent_bridge_receipts.
 */
async function storeDispatchProof(params: {
  agentId: string;
  taskId: string;
  dispatchId: string;
  runnerId: string;
  result: unknown;
  proofSha256: string | null;
  durationMs: number;
}) {
  const supabase = getSupabaseAdmin();
  const sessionId = `run_${params.agentId}_${Date.now()}`;
  const payloadHash = params.proofSha256
    ? `0x${params.proofSha256}`
    : `0x${createHash('sha256').update(JSON.stringify(params.result ?? {})).digest('hex')}`;

  // Store as bridge event (work_proof type)
  await supabase.from('agent_bridge_events').insert({
    session_id: sessionId,
    runtime_id: params.runnerId,
    agent_id: String(params.agentId),
    role: 'provider',
    event_type: 'work_proof',
    payload: {
      taskId: params.taskId,
      dispatchId: params.dispatchId,
      result: params.result,
      durationMs: params.durationMs,
    },
    payload_hash: payloadHash,
    metadata: { source: 'console-dispatch', runnerId: params.runnerId },
    source: 'console-dispatch',
    dry_run: false,
  }).select('id').single();

  // Store receipt
  await supabase.from('agent_bridge_receipts').insert({
    session_id: sessionId,
    receipt_type: 'x402_arc_native',
    payload_hash: payloadHash,
    metadata: {
      taskId: params.taskId,
      dispatchId: params.dispatchId,
      runnerId: params.runnerId,
      agentId: String(params.agentId),
      proofSha256: params.proofSha256,
      durationMs: params.durationMs,
    },
  }).select('id').single();
}

/**
 * x402 handler — runs AFTER payment settles.
 * Dispatches to registered runner via HMAC-signed request.
 */
async function handler(req: NextRequest) {
  const agentId = parseAgentId(req);
  if (!agentId) {
    return humanJson(req, { ok: false, error: 'invalid_agent_id' }, { status: 400 });
  }

  // Parse request body for task input
  let body: Record<string, unknown> = {};
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    // Empty body is fine for simple runs
  }

  const taskId = (body.taskId as string) ?? `task_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const role = (body.role as string) ?? 'provider';
  const protocol = (body.protocol as string) ?? 'generic';

  try {
    const result = await dispatchToRunner({
      agentId: String(agentId),
      taskId,
      role,
      protocol: protocol as 'erc8004' | 'erc8183' | 'x402' | 'generic',
      input: body.input ?? body,
      metadata: body.metadata as Record<string, unknown> | undefined,
    });

    // Store proof/receipt for successful dispatches
    if (result.ok) {
      await storeDispatchProof({
        agentId: String(agentId),
        taskId,
        dispatchId: result.dispatchId,
        runnerId: result.runnerId,
        result: result.result,
        proofSha256: result.proofSha256,
        durationMs: result.durationMs,
      }).catch((err) => {
        console.error('[run] Failed to store proof:', err);
      });
    }

    return humanJson(req, {
      ok: result.ok,
      agentId,
      dispatch: {
        dispatchId: result.dispatchId,
        runnerId: result.runnerId,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
      },
      result: result.result,
      proof: {
        sha256: result.proofSha256,
      },
      payment: { status: 'settled' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Distinguish "no runner" from "dispatch failed"
    if (message.includes('No active runner found')) {
      return humanJson(req, {
        ok: false,
        agentId,
        error: 'no_runner_registered',
        message: `No active runner registered for agent ${agentId}. Register a runner first.`,
        payment: { status: 'settled' },
      }, { status: 404 });
    }

    return humanJson(req, {
      ok: false,
      agentId,
      error: 'dispatch_failed',
      message,
      payment: { status: 'settled' },
    }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const agentId = parseAgentId(req);
  if (!agentId) {
    return humanJson(req, { ok: false, error: 'invalid_agent_id' }, { status: 400 });
  }

  return withX402(handler, {
    amount: process.env.X402_AGENT_RUN_AMOUNT_ATOMIC || '1',
    resource: `/api/agents/${agentId}/run`,
    description: 'x402-protected agent run endpoint',
    liveAgentId: String(agentId),
    liveAgentName: `Agent ${agentId}`,
    allowedRails: ['circle-gateway-passkey'],
    agentPayerBinding: {
      required: true,
      rail: 'circle-gateway' as AgentX402Rail,
      scope: 'homepage' as AgentX402Scope,
      getContext: async (req: NextRequest) => {
        const id = parseAgentId(req);
        return {
          agentId: String(id ?? agentId),
          runtimeId: req.headers.get('x-arclayer-runtime-id') || null,
          sessionId: null,
          jobId: null,
        };
      },
    },
  })(req);
}
