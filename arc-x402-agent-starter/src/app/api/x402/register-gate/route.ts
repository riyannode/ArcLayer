import { NextResponse } from "next/server";
import { buildX402Challenge, readPaymentHeader } from '@/lib/x402';

const RESOURCE = '/api/x402/register-gate';

export async function GET(req: Request) {
  const payment = readPaymentHeader(req);
  if (!payment) {
    return NextResponse.json(buildX402Challenge(RESOURCE, process.env.X402_REGISTER_GATE_AMOUNT_ATOMIC || '400000'), { status: 402 });
  }
  return NextResponse.json({ ok: true, unlocked: true, gate: 'register', txHash: '0xdemo-register' });
}
