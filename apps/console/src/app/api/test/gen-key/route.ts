/**
 * TEMPORARY test endpoint — generates API keys for live testing.
 * DELETE after tests complete.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createApiKey } from '@/lib/a2a/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const agentId = body.agentId || 'test-agent';
    const scopes = body.scopes || ['erc8183:create'];

    const result = await createApiKey({
      agentId,
      label: `test-key-${Date.now()}`,
      scopes,
      createdBy: 'live-test',
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
