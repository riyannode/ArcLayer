import { NextResponse } from "next/server";
import { buildX402Challenge, readPaymentHeader } from '@/lib/x402';

const RESOURCE = '/api/x402/create-job-gate';

export async function GET(req: Request) {
  const payment = readPaymentHeader(req);
  if (!payment) {
    return NextResponse.json(buildX402Challenge(RESOURCE, process.env.X402_CREATE_JOB_GATE_AMOUNT_ATOMIC || '100000'), { status: 402 });
  }
  return NextResponse.json({ ok: true, unlocked: true, gate: 'create-job', txHash: '0xdemo-job' });
}
