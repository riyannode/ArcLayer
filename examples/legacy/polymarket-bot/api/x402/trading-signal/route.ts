import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: 'deprecated_route',
      message: 'Paid trading signal is deprecated. Use /api/x402/bridge-access for ArcLayer agent bridge access.',
      replacement: '/api/x402/bridge-access',
    },
    { status: 410 },
  );
}
