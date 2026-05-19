import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const startedAt = new Date().toISOString();

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0',
    startedAt,
    uptime: process.uptime(),
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
}
