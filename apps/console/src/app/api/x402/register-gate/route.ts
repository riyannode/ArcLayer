import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

export const runtime = 'nodejs';

// 0.000001 USDC = 1 atomic unit (6 decimals)
const AMOUNT_ATOMIC = '1';
const RESOURCE = '/api/x402/register-gate';

async function handler(_req: NextRequest) {
  return NextResponse.json({
    ok: true,
    unlocked: true,
    message: 'Anti-spam registration fee paid. Proceed with registerAgent.',
    resource: RESOURCE,
    timestamp: new Date().toISOString(),
  });
}

export const GET = withX402(handler, {
  amount: process.env.X402_REGISTER_GATE_AMOUNT_ATOMIC || AMOUNT_ATOMIC,
  resource: RESOURCE,
  description: 'Anti-spam registration fee — prevents spam agent listings on the marketplace.',
});

export const POST = GET;
