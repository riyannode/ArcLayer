/**
 * GET /api/rails/overview — rail counts separated by settlement_mode
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { escrowRail, bridgeRail } from '@/lib/rails/responses';
import { countDistinctBridgeSessions } from '@/lib/agent-bridge/store';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiKey(req, [
      API_KEY_SCOPES.ERC8183_CREATE,
      API_KEY_SCOPES.ERC8183_TX,
      API_KEY_SCOPES.AGENT_BRIDGE_WRITE,
    ]);
    if (auth.error) return auth.error;

    const supabase = getSupabaseAdmin();

    // Count escrow jobs
    const { count: escrowCount, error: escrowErr } = await supabase
      .from('agent_jobs')
      .select('job_id', { count: 'exact', head: true })
      .eq('settlement_mode', 'erc8183_escrow');

    if (escrowErr) throw new Error(`escrow count: ${escrowErr.message}`);

    // Count x402 offchain jobs
    const { count: offchainCount, error: offchainErr } = await supabase
      .from('agent_jobs')
      .select('job_id', { count: 'exact', head: true })
      .eq('settlement_mode', 'x402_offchain');

    if (offchainErr) throw new Error(`offchain count: ${offchainErr.message}`);

    // Count bridge sessions (distinct session_ids)
    const bridgeSessions = await countDistinctBridgeSessions();

    // Count bridge events
    const { count: bridgeEvents, error: bridgeEventsErr } = await supabase
      .from('agent_bridge_events')
      .select('id', { count: 'exact', head: true });

    if (bridgeEventsErr) throw new Error(`bridge events count: ${bridgeEventsErr.message}`);

    return NextResponse.json({
      ok: true,
      rails: {
        escrow: {
          ...escrowRail(),
          count: escrowCount ?? 0,
        },
        offchain_job: {
          rail: 'offchain_job',
          settlementMode: 'x402_offchain',
          count: offchainCount ?? 0,
        },
        bridge: {
          ...bridgeRail(),
          sessions: bridgeSessions ?? 0,
          events: bridgeEvents ?? 0,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'rails_overview_failed', message },
      { status: 500 },
    );
  }
}
