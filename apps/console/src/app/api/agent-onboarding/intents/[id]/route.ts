import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { getMetadataDraft } from '@/lib/a2a/metadata-drafts/store';
import { authenticateWalletRequest } from '@/lib/mcp/session-auth';
import { getRegistrationIntent } from '@/lib/agent-onboarding/registration-intents';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateWalletRequest(req);
  if (!auth.authenticated) {
    return humanJson(req, { ok: false, error: auth.error }, { status: auth.status, headers: { 'Cache-Control': 'no-store' } });
  }

  const { id } = await ctx.params;
  const intent = await getRegistrationIntent(id);
  if (!intent) return humanJson(req, { ok: false, error: 'intent_not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (intent.ownerAddress.toLowerCase() !== auth.wallet.toLowerCase()) {
    return humanJson(req, { ok: false, error: 'forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (new Date(intent.expiresAt).getTime() < Date.now() || intent.status !== 'draft') {
    return humanJson(req, { ok: false, error: 'intent_not_active', status: intent.status }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
  }

  const draft = await getMetadataDraft(intent.draftId);
  if (!draft) return humanJson(req, { ok: false, error: 'draft_not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

  const metadataURI = `${req.nextUrl.origin}/api/a2a/metadata/draft/${intent.draftId}`;
  return humanJson(req, {
    ok: true,
    intent,
    draft: {
      draftId: draft.draftId,
      controller: draft.controller,
      metadata: draft.metadata,
      status: draft.status,
      agentId: draft.agentId,
      txHash: draft.txHash,
      metadataURI,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
