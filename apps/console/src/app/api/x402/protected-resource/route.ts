import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { withX402 } from '@/lib/x402';
import { getPlatformX402PayTo } from '@/lib/x402/platform-pay-to';

export const runtime = 'nodejs';

const DEFAULT_AMOUNT_ATOMIC = '1'; // 0.000001 USDC, 6 decimals
const RESOURCE = '/api/x402/protected-resource';

async function protectedHandler(_req: NextRequest) {
  return humanJson(_req, {
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
  payTo: getPlatformX402PayTo(),
  // Platform-owned seller: payTo = ArcLayer platform payout.
  description: 'ArcLayer x402 protected resource: Circle Gateway nanopayment',
});

export const POST = GET;
