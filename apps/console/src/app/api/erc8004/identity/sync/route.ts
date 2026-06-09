import { humanJson } from '@/lib/api/human-json';
/**
 * POST /api/erc8004/identity/sync
 *
 * Given a register tx hash, verify the on-chain ERC-8004 mint
 * and upsert canonical identity data to erc8004_agents.
 *
 * This removes dependence on indexer delay after mint.
 * If user mints agent 31380, backend can sync immediately from tx hash.
 */

import { NextRequest } from 'next/server';
import { isAddress } from 'viem';
import { syncErc8004Identity } from '@/lib/erc8004/sync';

export const dynamic = 'force-dynamic';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate required fields
    if (!body.txHash || typeof body.txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(body.txHash)) {
      return humanJson(req, { ok: false, error: 'invalid_txHash', detail: 'txHash must be a 0x-prefixed 66-char hex string (0x + 64 hex chars)' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    if (!body.expectedController || !isAddress(body.expectedController)) {
      return humanJson(req, { ok: false, error: 'invalid_expectedController', detail: 'expectedController must be a valid EVM address' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    const result = await syncErc8004Identity({
      txHash: body.txHash,
      expectedController: body.expectedController,
      metadataURI: body.metadataURI,
      draftId: body.draftId,
      writeToken: body.writeToken,
    });

    return humanJson(req, result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';

    const status =
      message === 'tx_not_found_or_not_mined' ? 202 :
      message === 'tx_reverted' ? 422 :
      message === 'metadata_uri_mismatch' ? 422 :
      message === 'token_uri_read_failed' ? 502 :
      message.startsWith('ERC-8004 mint Transfer event not found') ? 422 :
      message.startsWith('upsert_failed') ? 502 :
      500;

    return humanJson(req, { ok: false, error: 'sync_failed', detail: message }, { status, headers: { 'Cache-Control': ERROR_CACHE } });
  }
}
