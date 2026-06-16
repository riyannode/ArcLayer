/**
 * POST /api/erc8004/register/sync
 *
 * Sync an on-chain ERC-8004 registration to erc8004_agents table.
 * Called by the Runner after Circle CLI registration succeeds.
 *
 * This endpoint:
 * 1. Reads the tx receipt, extracts tokenId from Transfer event
 * 2. Reads canonical metadataURI from chain
 * 3. Upserts to erc8004_agents with role metadata
 * 4. Verifies the agent is visible from the agents table
 *
 * Success = tx ✓ + upsert ✓ + visible in GET /api/erc8004/agents ✓
 */

import { NextResponse } from 'next/server';
import { syncErc8004Identity } from '@/lib/erc8004/sync';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export const dynamic = 'force-dynamic';

// ── Shared-secret auth for runner → console sync ─────────────────────────

function assertRunnerSyncAuth(request: Request): Response | null {
  const expected = process.env.ARCLAYER_RUNNER_SYNC_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'sync_secret_not_configured' },
      { status: 500 },
    );
  }
  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  const headerSecret = request.headers.get('x-arclayer-runner-sync-secret');
  if (bearer !== expected && headerSecret !== expected) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized_sync_request' },
      { status: 401 },
    );
  }
  return null;
}

interface SyncRequestBody {
  txHash: string;
  controllerAddress: string;
  role?: string;
  agentName?: string;
  metadataJson?: Record<string, unknown>;
  approvalId?: string;
}

export async function POST(request: Request) {
  // Auth: require runner sync secret before reading body
  const authError = assertRunnerSyncAuth(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as SyncRequestBody;

    // Validate required fields
    if (!body.txHash || !/^0x[a-fA-F0-9]{64}$/.test(body.txHash)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_txHash', detail: 'txHash must be a valid 0x-prefixed 64-hex-char string' },
        { status: 400 },
      );
    }

    if (!body.controllerAddress || !/^0x[a-fA-F0-9]{40}$/.test(body.controllerAddress)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_controllerAddress', detail: 'controllerAddress must be a valid EVM address' },
        { status: 400 },
      );
    }

    if (body.role && !['provider', 'evaluator'].includes(body.role)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_role', detail: 'role must be provider or evaluator' },
        { status: 400 },
      );
    }

    // 1. Sync on-chain mint to erc8004_agents (reuse existing sync logic)
    const syncResult = await syncErc8004Identity({
      txHash: body.txHash,
      expectedController: body.controllerAddress,
    });

    // 2. Enrich metadata_json with role information
    const supabase = getSupabaseAdmin();
    const metadataJson: Record<string, unknown> = {
      ...(body.metadataJson ?? {}),
      role: body.role ?? 'unknown',
      roles: body.role ? [body.role] : [],
      registrationApprovalId: body.approvalId ?? null,
      source: 'chat_approval',
    };

    if (body.agentName) {
      metadataJson.name = body.agentName;
    }

    // 3. Update metadata_json on the row
    const { error: updateError } = await supabase
      .from('erc8004_agents')
      .update({
        metadata_json: metadataJson,
        source: 'chat_approval',
        updated_at: new Date().toISOString(),
      })
      .eq('token_id', syncResult.tokenId);

    if (updateError) {
      // Upsert succeeded but metadata enrichment failed
      // Agent exists in erc8004_agents but without role metadata
      return NextResponse.json({
        ok: false,
        error: 'metadata_enrichment_failed',
        detail: `Agent registered on-chain (tokenId: ${syncResult.tokenId}) but metadata enrichment failed: ${updateError.message}`,
        tokenId: syncResult.tokenId,
        agentId: syncResult.agentId,
        txHash: body.txHash,
        agentVisible: true, // Row exists, just missing enriched metadata
        errorCode: 'partial_persistence',
      }, { status: 502 });
    }

    // 4. Verify agent is actually visible from GET /api/erc8004/agents
    const { data: verifyRow, error: verifyError } = await supabase
      .from('erc8004_agents')
      .select('token_id, agent_id, metadata_json')
      .eq('token_id', syncResult.tokenId)
      .single();

    const agentVisible = !!verifyRow && !verifyError;

    if (!agentVisible) {
      return NextResponse.json({
        ok: false,
        error: 'visibility_verification_failed',
        detail: 'Agent was upserted but cannot be read back from erc8004_agents',
        tokenId: syncResult.tokenId,
        agentId: syncResult.agentId,
        txHash: body.txHash,
        agentVisible: false,
        errorCode: 'failed_persistence',
      }, { status: 502 });
    }

    // 5. Full success: tx ✓ + upsert ✓ + visible ✓
    return NextResponse.json({
      ok: true,
      tokenId: syncResult.tokenId,
      agentId: syncResult.agentId,
      owner: syncResult.owner,
      controller: syncResult.controller,
      metadataURI: syncResult.metadataURI,
      txHash: body.txHash,
      blockNumber: syncResult.blockNumber,
      registryAddress: syncResult.registryAddress,
      chainId: syncResult.chainId,
      role: body.role ?? 'unknown',
      agentVisible: true,
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);

    // Distinguish sync failures
    if (detail.includes('tx_not_found') || detail.includes('not_mined')) {
      return NextResponse.json(
        { ok: false, error: 'tx_not_mined_yet', detail, retryable: true, agentVisible: false },
        { status: 425 },
      );
    }

    if (detail.includes('tx_reverted')) {
      return NextResponse.json(
        { ok: false, error: 'tx_sync_failed', detail, retryable: false, agentVisible: false },
        { status: 422 },
      );
    }

    if (detail.includes('upsert_failed')) {
      return NextResponse.json(
        { ok: false, error: 'failed_persistence', detail, agentVisible: false, errorCode: 'failed_persistence' },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { ok: false, error: 'erc8004_register_sync_failed', detail, agentVisible: false },
      { status: 500 },
    );
  }
}
