import { NextRequest, NextResponse } from 'next/server';
import { recoverMessageAddress, type Hex } from 'viem';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { withX402 } from '@/lib/x402';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const AGENT_REGISTRY = '0xB263336055dD65FF501e36CA39941760D943703C' as Hex;
const FROM_BLOCK = BigInt(process.env.AGENT_REGISTRY_FROM_BLOCK || '0');
const MAX_TIMESTAMP_SKEW_SEC = 5 * 60;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const BUCKET = 'agent-avatars';

const AGENT_REGISTERED = parseAbiItem(
  'event AgentRegistered(uint256 indexed agentId, bytes32 indexed skillHash, address indexed controller, string metadataURI)'
);

async function getOnchainController(agentId: string): Promise<string | null> {
  try {
    const client = createPublicClient({ transport: http(RPC) });
    const idBig = BigInt(agentId);
    const logs = await client.getLogs({
      address: AGENT_REGISTRY,
      event: AGENT_REGISTERED,
      args: { agentId: idBig },
      fromBlock: FROM_BLOCK,
      toBlock: 'latest',
    });
    if (logs.length === 0) return null;
    const latest = logs.sort(
      (a, b) => Number(b.blockNumber ?? BigInt(0)) - Number(a.blockNumber ?? BigInt(0))
    )[0];
    return latest.args.controller?.toLowerCase() ?? null;
  } catch (err) {
    console.error('[avatar.upload] controller lookup failed', err);
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

async function postHandler(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const agentId = form.get('agentId');
  const signature = form.get('signature');
  const ts = form.get('ts');
  const file = form.get('file');

  if (typeof agentId !== 'string' || !/^\d+$/.test(agentId)) {
    return NextResponse.json({ error: 'agentId must be numeric' }, { status: 400 });
  }
  if (typeof signature !== 'string' || !/^0x[a-fA-F0-9]+$/.test(signature)) {
    return NextResponse.json({ error: 'signature must be hex' }, { status: 400 });
  }
  if (typeof ts !== 'string' || !/^\d+$/.test(ts)) {
    return NextResponse.json({ error: 'ts must be unix seconds' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'file too large (max 2 MB)' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'unsupported file type' }, { status: 400 });
  }

  const tsNum = Number(ts);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > MAX_TIMESTAMP_SKEW_SEC) {
    return NextResponse.json({ error: 'signature timestamp out of bounds' }, { status: 400 });
  }

  // Verify signer === on-chain controller
  const message = `ArcLayer Avatar Upload\nagentId=${agentId}\nts=${tsNum}`;
  let signer: string;
  try {
    signer = (await recoverMessageAddress({ message, signature: signature as `0x${string}` })).toLowerCase();
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  const controller = await getOnchainController(agentId);
  if (!controller) {
    return NextResponse.json({ error: 'agent not registered on-chain' }, { status: 403 });
  }
  if (signer !== controller) {
    return NextResponse.json({ error: 'signer is not the on-chain controller' }, { status: 403 });
  }

  // Upload to Supabase Storage
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
    return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = pub?.publicUrl;
  if (!url) {
    return NextResponse.json({ error: 'failed to resolve public URL' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url });
}

// 0.001 USDC = 1000 atomic (6 decimals). Avatar uploads consume storage and are paid actions.
export const POST = withX402(postHandler, {
  amount: '1000',
  resource: '/api/a2a/avatar/upload',
  description: 'Upload an A2A agent avatar — storage anti-spam fee',
});
