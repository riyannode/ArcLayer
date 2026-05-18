import { NextResponse } from 'next/server';
import { settleDualPayment } from '../_lib';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const result = await settleDualPayment(req);
  if ('response' in result) return result.response;
  if (!result.result.isValid) {
    return NextResponse.json({ ok: false, mode: result.parsed.mode, verify: result.result }, { status: 402 });
  }

  const success = 'settleResult' in result && result.settleResult?.success;
  return NextResponse.json({
    ok: success,
    mode: result.parsed.mode === 'gateway' ? 'x402-circle-gateway' : 'x402-native',
    verify: result.result,
    settle: 'settleResult' in result ? result.settleResult : null,
  }, { status: success ? 200 : 402 });
}
