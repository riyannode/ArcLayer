import { humanJson } from '@/lib/api/human-json';
import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { recoverMessageAddress } from 'viem';
import { getERC8004OwnerOf } from '@/lib/contracts/erc8004';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { withX402 } from '@/lib/x402';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const MAX_TIMESTAMP_SKEW_SEC = 5 * 60;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const BUCKET = 'agent-avatars';

async function getOnchainController(agentId: string): Promise<string | null> {
  try {
    return (await getERC8004OwnerOf(agentId)).toLowerCase();
  } catch (err) {
    console.warn('[avatar.upload] ERC-8004 ownerOf lookup returned no controller', err);
    return null;
  }
}

function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'bin';
}

function buildAvatarCommitToken(agentId: string, url: string): string {
  const secret = process.env.AVATAR_COMMIT_SECRET;
  if (!secret) {
    throw new Error('avatar_commit_secret_missing');
  }

  const payload = {
    agentId,
    url,
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  };
  const payloadBase64Url = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadBase64Url).digest('base64url');
  return `${payloadBase64Url}.${signature}`;
}

async function postHandler(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return humanJson(req, { error: 'Invalid form data' }, { status: 400 });
  }

  const agentId = form.get('agentId');
  const signature = form.get('signature');
  const ts = form.get('ts');
  const file = form.get('file');

  if (typeof agentId !== 'string' || !/^\d+$/.test(agentId)) {
    return humanJson(req, { error: 'agentId must be numeric' }, { status: 400 });
  }
  if (typeof signature !== 'string' || !/^0x[a-fA-F0-9]+$/.test(signature)) {
    return humanJson(req, { error: 'signature must be hex' }, { status: 400 });
  }
  if (typeof ts !== 'string' || !/^\d+$/.test(ts)) {
    return humanJson(req, { error: 'ts must be unix seconds' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return humanJson(req, { error: 'file is required' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return humanJson(req, { error: 'file too large (max 2 MB)' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return humanJson(req, { error: 'unsupported file type' }, { status: 400 });
  }

  const tsNum = Number(ts);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > MAX_TIMESTAMP_SKEW_SEC) {
    return humanJson(req, { error: 'signature timestamp out of bounds' }, { status: 400 });
  }

  const message = `ArcLayer Avatar Upload\nagentId=${agentId}\nts=${tsNum}`;
  let signer: string;
  try {
    signer = (await recoverMessageAddress({ message, signature: signature as `0x${string}` })).toLowerCase();
  } catch {
    return humanJson(req, { error: 'invalid signature' }, { status: 400 });
  }

  const controller = await getOnchainController(agentId);
  if (!controller) {
    return humanJson(req, { error: 'agent not registered on-chain' }, { status: 403 });
  }
  if (signer !== controller) {
    return humanJson(req, { error: 'signer is not the on-chain controller' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const ext = extFromMime(file.type);
  const path = `${agentId}/${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: false,
    cacheControl: '31536000',
  });

  if (upErr) {
    console.error('[avatar.upload] storage error', upErr.message);
    return humanJson(req, { error: `upload failed: ${upErr.message}` }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = pub?.publicUrl;
  if (!url) {
    return humanJson(req, { error: 'failed to resolve public URL' }, { status: 500 });
  }

  try {
    const avatarCommitToken = buildAvatarCommitToken(agentId, url);
    return humanJson(req, { ok: true, url, avatarCommitToken });
  } catch {
    return humanJson(req, { error: 'avatar_commit_secret_missing' }, { status: 500 });
  }
}

export const POST = withX402(postHandler, {
  amount: '1',
  resource: '/api/a2a/avatar/upload',
  description: 'Upload an A2A agent avatar — storage anti-spam fee',
  requireResourceContext: false,
  settleBeforeHandler: true,
});
