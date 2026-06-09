import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const startedAt = new Date().toISOString();

export async function GET(req: NextRequest) {
  return humanJson(req, {
    status: 'ok',
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0',
    startedAt,
    uptime: process.uptime(),
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
}
