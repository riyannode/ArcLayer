import { humanJson } from '@/lib/api/human-json';
import { getManifest } from '@/lib/a2a/manifest';
import { getERC8004OwnerOf } from '@/lib/contracts/erc8004';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Official ERC-8004 identity controller lookup.
 * The canonical agentId is the ERC-721 tokenId minted by register(metadataURI),
 * so controller ownership must come from ownerOf(agentId), not legacy AgentRegistered logs.
 * Returns null when the token is not minted yet (TOFU/pending manifest window).
 */
async function getOnchainController(agentId: string): Promise<string | null> {
  try {
    return (await getERC8004OwnerOf(agentId)).toLowerCase();
  } catch (err) {
    console.warn('[manifest.api] ERC-8004 ownerOf lookup returned no controller', err);
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  if (!agentId || !/^[0-9]+$/.test(agentId)) {
    return humanJson(_req, { error: 'invalid agentId' }, { status: 400 });
  }

  const stored = await getManifest(agentId);
  if (!stored) {
    return humanJson(_req, { error: 'manifest not found' }, { status: 404 });
  }

  // Cross-verify against on-chain controller — drop stale TOFU rows where
  // the on-chain controller now disagrees with the stored signer.
  const onchainController = await getOnchainController(agentId);
  if (onchainController && stored.signer && stored.signer !== onchainController) {
    return humanJson(_req, { error: 'manifest controller mismatch with on-chain registration' }, { status: 410 });
  }

  return humanJson(_req, {
    agentId: stored.agentId,
    manifest: stored.manifest,
    manifestHash: stored.manifestHash,
    controller: onchainController ?? stored.controller,
    signer: stored.signer,
    updatedAt: stored.updatedAt,
    tofu: !onchainController,
  });
}
