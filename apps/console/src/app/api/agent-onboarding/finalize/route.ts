import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { getAddress } from 'viem';
import { getActiveAgentAccountForOwnerAndAddress } from '@/lib/agent-accounts/store';
import { getRegistrationIntent, completeRegistrationIntent } from '@/lib/agent-onboarding/registration-intents';
import { parseManifest, upsertManifest, manifestHash, type AgentManifestV1 } from '@/lib/a2a/manifest';
import { updateMetadataDraftServer } from '@/lib/a2a/metadata-drafts/store';
import { getERC8004OwnerOf } from '@/lib/contracts/erc8004';
import { authenticateWalletRequest } from '@/lib/mcp/session-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isHexHash(value: unknown) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

async function walletControlsOnchainOwner(wallet: string, onchainOwner: string) {
  if (wallet.toLowerCase() === onchainOwner.toLowerCase()) return true;
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
  if (new Date(intent.expiresAt).getTime() < Date.now() || intent.status !== 'draft') return humanJson(req, { ok: false, error: 'intent_not_active', status: intent.status }, { status: 410 });

  const parsed = parseManifest(rawManifest);
  if (!parsed.ok) return humanJson(req, { ok: false, error: parsed.error }, { status: 400 });
  const manifest = rawManifest as AgentManifestV1;
  if (parsed.manifest.agentId !== agentId) return humanJson(req, { ok: false, error: 'manifest_agentId_mismatch' }, { status: 400 });

  let onchainOwner: string;
  try {
    onchainOwner = getAddress(await getERC8004OwnerOf(agentId)).toLowerCase();
  } catch {
    return humanJson(req, { ok: false, error: 'onchain_owner_lookup_failed' }, { status: 400 });
  }

  const controls = await walletControlsOnchainOwner(auth.wallet, onchainOwner);
  if (!controls) return humanJson(req, { ok: false, error: 'wallet_does_not_control_agent' }, { status: 403 });

  const hash = manifestHash(manifest);
  const patch = await updateMetadataDraftServer({ draftId: intent.draftId, metadata: manifest, agentId, txHash: txHash as string });
  if (!patch.ok) return humanJson(req, { ok: false, error: 'draft_update_failed', detail: patch.error }, { status: 500 });

  const upsert = await upsertManifest({
    agentId,
    controller: onchainOwner,
    manifest,
    manifestHash: hash,
    signature: txHash as string,
    signer: onchainOwner,
  });
  if (!upsert.ok) return humanJson(req, { ok: false, error: 'manifest_upsert_failed', detail: upsert.error }, { status: 500 });

  const completed = await completeRegistrationIntent({ id: intent.id, agentId, txHash: txHash as string });
  if (!completed.ok) return humanJson(req, { ok: false, error: 'intent_complete_failed', detail: completed.error }, { status: 500 });

  return humanJson(req, {
    ok: true,
    agentId,
    txHash,
    manifestURI: `arclayer://manifest/${agentId}`,
    manifestHash: hash,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
