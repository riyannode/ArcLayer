import { NextRequest, NextResponse } from 'next/server';
import { createMetadataDraft } from '@/lib/a2a/metadata-drafts/store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isAddress(value: unknown) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export async function POST(req: NextRequest) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
  }

  const { controller, metadata } = body as {
    controller?: unknown;
    metadata?: unknown;
  };

  if (!isAddress(controller)) {
    return NextResponse.json({ error: 'controller must be a wallet address' }, { status: 400 });
  }

  if (!metadata || typeof metadata !== 'object') {
    return NextResponse.json({ error: 'metadata must be an object' }, { status: 400 });
  }

  const controllerAddress = String(controller);
  const result = await createMetadataDraft({
    controller: controllerAddress,
    metadata,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const metadataURI = `${req.nextUrl.origin}/api/a2a/metadata/draft/${result.draftId}`;

  return NextResponse.json({
    ok: true,
    draftId: result.draftId,
    writeToken: result.writeToken,
    metadataURI,
  });
}
