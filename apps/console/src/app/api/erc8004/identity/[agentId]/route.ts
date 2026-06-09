import { humanJson } from '@/lib/api/human-json';
/**
 * GET /api/erc8004/identity/[agentId]
 *
 * Returns canonical ERC-8004 identity for a given agentId/tokenId.
 * Reads from erc8004_agents table (synced via /api/erc8004/identity/sync).
 */

import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export const dynamic = 'force-dynamic';

const CACHE = 'public, s-maxage=30, stale-while-revalidate=120';
const ERROR_CACHE = 'no-store, no-cache, max-age=0';

function toAgent(row: Record<string, unknown>) {
  return {
    agentId: row.agent_id,
    tokenId: row.token_id,
    owner: row.owner,
    controller: row.controller,
    metadataURI: row.metadata_uri,
    metadata: row.metadata_json ?? null,
    source: row.source,
    chainId: row.chain_id,
    registryAddress: row.registry_address,
    txHash: row.tx_hash,
    blockNumber: row.block_number,
    mintedAt: row.minted_at,
    updatedAt: row.updated_at,
    onchainVerified: true,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;

    if (!agentId || agentId.trim().length === 0) {
      return humanJson(req, { ok: false, error: 'missing_agentId' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('erc8004_agents')
      .select('*')
      .eq('token_id', agentId.trim())
      .maybeSingle();

    if (error) {
      return humanJson(req, { ok: false, error: 'query_failed', detail: error.message }, { status: 502, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    if (!data) {
      return humanJson(req, { ok: false, error: 'not_found', agentId: agentId.trim() }, { status: 404, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    return humanJson(req, { ok: true, agent: toAgent(data) }, { headers: { 'Cache-Control': CACHE } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown_error';
    return humanJson(req, { ok: false, error: 'identity_route_failed', detail }, { status: 500, headers: { 'Cache-Control': ERROR_CACHE } });
  }
}
