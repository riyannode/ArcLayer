import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';
const ERROR_CACHE_CONTROL = 'no-store, no-cache, max-age=0';

function toAgent(row: Record<string, any>) {
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
    onchain: true,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tokenId = searchParams.get('tokenId');
    const controller = searchParams.get('controller');
    const limitRaw = searchParams.get('limit') ?? '100';

    const limit = Math.min(Math.max(Number(limitRaw) || 100, 1), 500);

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('erc8004_agents')
      .select(
        'token_id,agent_id,owner,controller,metadata_uri,metadata_json,source,chain_id,registry_address,tx_hash,block_number,minted_at,updated_at',
      )
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (tokenId) {
      query = query.eq('token_id', tokenId);
    }

    if (controller) {
      query = query.ilike('controller', controller);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: 'erc8004_agents_query_failed',
          detail: error.message,
          agents: [],
        },
        { status: 502, headers: { 'Cache-Control': ERROR_CACHE_CONTROL } },
      );
    }

    const agents = (data ?? []).map(toAgent);

    return NextResponse.json(
      {
        ok: true,
        source: 'supabase_erc8004_agents',
        agents,
        total: agents.length,
        timestamp: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown_error';

    return NextResponse.json(
      {
        ok: false,
        error: 'erc8004_agents_route_failed',
        detail,
        agents: [],
      },
      { status: 500, headers: { 'Cache-Control': ERROR_CACHE_CONTROL } },
    );
  }
}
