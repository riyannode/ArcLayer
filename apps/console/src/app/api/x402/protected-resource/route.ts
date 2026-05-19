import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

export const runtime = 'nodejs';

const DEFAULT_AMOUNT_ATOMIC = '40000'; // 0.04 USDC, 6 decimals
const RESOURCE = '/api/x402/protected-resource';

async function protectedHandler(_req: NextRequest) {
  return NextResponse.json({
    ok: true,
    unlocked: true,
    message: 'ArcLayer x402 protected resource unlocked',
    data: {
      proof: 'paid-content',
      resource: RESOURCE,
      timestamp: new Date().toISOString(),
    },
  });
}

export const GET = withX402(protectedHandler, {
  amount: process.env.X402_PROTECTED_RESOURCE_AMOUNT_ATOMIC || process.env.X402_DEMO_AMOUNT_ATOMIC || DEFAULT_AMOUNT_ATOMIC,
  resource: RESOURCE,
  description: 'ArcLayer x402 protected resource: Circle Gateway + Arc Native EIP-3009',
});

export const POST = GET;
