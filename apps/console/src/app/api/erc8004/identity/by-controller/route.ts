import { humanJson } from '@/lib/api/human-json';
/**
 * GET /api/erc8004/identity/by-controller?controller=0x...
 *
 * Returns all minted ERC-8004 identities owned/controlled by a wallet.
 * Reads from erc8004_agents table.
 */

import { NextRequest } from 'next/server';
import { getAddress, isAddress } from 'viem';
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

export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get('controller');

    if (!raw?.trim()) {
      return humanJson(req, { ok: false, error: 'missing_controller', detail: 'controller query param required' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    if (!isAddress(raw.trim())) {
      return humanJson(req, { ok: false, error: 'invalid_controller', detail: 'controller must be a valid EVM address' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    const controller = getAddress(raw.trim()).toLowerCase();

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('erc8004_agents')
      .select('*')
      .eq('controller', controller)
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      return humanJson(req, { ok: false, error: 'query_failed', detail: error.message }, { status: 502, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    const agents = (data ?? []).map(toAgent);

    return humanJson(req, { ok: true, controller, agents, count: agents.length }, { headers: { 'Cache-Control': CACHE } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown_error';
    return humanJson(req, { ok: false, error: 'by_controller_route_failed', detail }, { status: 500, headers: { 'Cache-Control': ERROR_CACHE } });
  }
}
