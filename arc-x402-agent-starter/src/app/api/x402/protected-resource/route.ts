import { NextResponse } from "next/server";
import { buildX402Challenge, readPaymentHeader } from '@/lib/x402';

const RESOURCE = '/api/x402/protected-resource';

export async function GET(req: Request) {
  const payment = readPaymentHeader(req);
  if (!payment) {
    return NextResponse.json(buildX402Challenge(RESOURCE, process.env.X402_PROTECTED_RESOURCE_AMOUNT_ATOMIC || '1'), { status: 402 });
  }
  return NextResponse.json({ ok: true, unlocked: true, txHash: '0xdemo-protected', resource: RESOURCE });
}
