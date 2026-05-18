import { NextResponse } from 'next/server';
import { verifyDualPayment } from '../_lib';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const verified = await verifyDualPayment(req);
  if ('response' in verified) return verified.response;

  return NextResponse.json({
    ok: verified.result.isValid,
    mode: verified.parsed.mode === 'gateway' ? 'x402-circle-gateway' : 'x402-native',
    ...verified.result,
  }, { status: verified.result.isValid ? 200 : 402 });
}
