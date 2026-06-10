import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { getAddress } from 'viem';
import { getActiveAgentAccountForOwnerAndAddress } from '@/lib/agent-accounts/store';
import { isAgentAccountServerRailEnabled } from '@/lib/agent-accounts/feature-flags';
import { getRegistrationIntent, completeRegistrationIntent } from '@/lib/agent-onboarding/registration-intents';
import { parseManifest, upsertManifest, manifestHash, type AgentManifestV1 } from '@/lib/a2a/manifest';
import { updateMetadataDraftServer } from '@/lib/a2a/metadata-drafts/store';
import { getERC8004MintedTokenIdFromTxHash, getERC8004OwnerOf } from '@/lib/contracts/erc8004';
import { authenticateWalletRequest } from '@/lib/mcp/session-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isHexHash(value: unknown) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

async function walletControlsOnchainOwner(wallet: string, onchainOwner: string) {
  if (wallet.toLowerCase() === onchainOwner.toLowerCase()) return true;
  if (!isAgentAccountServerRailEnabled()) return false;
  const account = await getActiveAgentAccountForOwnerAndAddress(wallet, onchainOwner);
  return Boolean(account);
}

export async function POST(req: NextRequest) {
  const auth = await authenticateWalletRequest(req);
  if (!auth.authenticated) {
    return humanJson(req, { ok: false, error: auth.error }, { status: auth.status, headers: { 'Cache-Control': 'no-store' } });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return humanJson(req, { ok: false, error: 'invalid_json' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return humanJson(req, { ok: false, error: 'invalid_body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const { intentId, agentId, txHash, manifest: rawManifest } = body as Record<string, unknown>;
  if (typeof intentId !== 'string' || !intentId.trim()) return humanJson(req, { ok: false, error: 'intentId_required' }, { status: 400 });
  if (typeof agentId !== 'string' || !agentId.trim()) return humanJson(req, { ok: false, error: 'agentId_required' }, { status: 400 });
  if (!isHexHash(txHash)) return humanJson(req, { ok: false, error: 'txHash_invalid' }, { status: 400 });

  const intent = await getRegistrationIntent(intentId);
  if (!intent) return humanJson(req, { ok: false, error: 'intent_not_found' }, { status: 404 });
  if (intent.ownerAddress.toLowerCase() !== auth.wallet.toLowerCase()) return humanJson(req, { ok: false, error: 'forbidden' }, { status: 403 });
  if (intent.status === 'completed') {
    const sameAgent = intent.agentId === agentId;
    const sameTx = intent.txHash?.toLowerCase() === (txHash as string).toLowerCase();
    if (sameAgent && sameTx) {
      return humanJson(req, {
        ok: true,
        idempotent: true,
        agentId,
        txHash,
        manifestURI: `arclayer://manifest/${agentId}`,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return humanJson(req, { ok: false, error: 'intent_complete_conflict' }, { status: 409 });
  }
  if (new Date(intent.expiresAt).getTime() < Date.now() || intent.status !== 'draft') return humanJson(req, { ok: false, error: 'intent_not_active', status: intent.status }, { status: 410 });

  const parsed = parseManifest(rawManifest);
  if (!parsed.ok) return humanJson(req, { ok: false, error: parsed.error }, { status: 400 });
  if (parsed.manifest.agentId !== agentId) return humanJson(req, { ok: false, error: 'manifest_agentId_mismatch' }, { status: 400 });

  let mintedTokenId: bigint;
  try {
    mintedTokenId = await getERC8004MintedTokenIdFromTxHash(txHash as `0x${string}`);
  } catch {
    return humanJson(req, { ok: false, error: 'tx_receipt_invalid' }, { status: 400 });
  }
  if (mintedTokenId.toString() !== agentId) {
    return humanJson(req, { ok: false, error: 'tx_agentId_mismatch' }, { status: 400 });
  }

  let onchainOwner: string;
  try {
    onchainOwner = getAddress(await getERC8004OwnerOf(agentId)).toLowerCase();
  } catch {
    return humanJson(req, { ok: false, error: 'onchain_owner_lookup_failed' }, { status: 400 });
  }

  const manifestController = parsed.manifest.controller?.toLowerCase();
  if (manifestController && manifestController !== onchainOwner) {
    return humanJson(
      req,
      {
        ok: false,
        error: 'manifest_controller_mismatch',
        detail: 'Manifest controller must match ERC-8004 ownerOf(agentId).',
      },
      { status: 400 },
    );
  }

  const controls = await walletControlsOnchainOwner(auth.wallet, onchainOwner);
  if (!controls) return humanJson(req, { ok: false, error: 'wallet_does_not_control_agent' }, { status: 403 });

  const finalManifest: AgentManifestV1 = {
    ...parsed.manifest,
    controller: onchainOwner,
    updatedAt: new Date().toISOString(),
  };

  const hash = manifestHash(finalManifest);
  const patch = await updateMetadataDraftServer({ draftId: intent.draftId, metadata: finalManifest, agentId, txHash: txHash as string });
  if (!patch.ok) return humanJson(req, { ok: false, error: 'draft_update_failed', detail: patch.error }, { status: 500 });

  const upsert = await upsertManifest({
    agentId,
    controller: onchainOwner,
    manifest: finalManifest,
    manifestHash: hash,
    signature: txHash as string,
    signer: onchainOwner,
  });
  if (!upsert.ok) return humanJson(req, { ok: false, error: 'manifest_upsert_failed', detail: upsert.error }, { status: 500 });

  const completed = await completeRegistrationIntent({ id: intent.id, agentId, txHash: txHash as string });
  if (!completed.ok) {
    if ('conflict' in completed && completed.conflict) {
      return humanJson(req, { ok: false, error: completed.error }, { status: 409 });
    }
    return humanJson(req, { ok: false, error: 'intent_complete_failed', detail: completed.error }, { status: 500 });
  }

  return humanJson(req, {
    ok: true,
    ...('idempotent' in completed && completed.idempotent ? { idempotent: true } : {}),
    agentId,
    txHash,
    manifestURI: `arclayer://manifest/${agentId}`,
    manifestHash: hash,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
