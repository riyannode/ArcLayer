import { humanJson } from '@/lib/api/human-json';
import { settleDualPayment } from '../_lib';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let settled: Awaited<ReturnType<typeof settleDualPayment>>;
  try {
    settled = await settleDualPayment(req);
  } catch (error) {
    console.error('[x402/settle] payment settlement failed', error);
    return humanJson(req, {
      ok: false,
      error: 'payment_settlement_failed',
      message: 'Payment settlement failed.',
    }, { status: 502 });
  }
  if ('response' in settled) return settled.response;
  if (!settled.result.isValid) {
    return humanJson(req, { ok: false, mode: settled.parsed.mode, verify: settled.result }, { status: 402 });
  }

  const success = 'settleResult' in settled && settled.settleResult?.success;
  return humanJson(req, {
    ok: success,
    mode: settled.parsed.mode === 'gateway' ? 'x402-circle-gateway' : 'x402-native',
    verify: settled.result,
    settle: 'settleResult' in settled ? settled.settleResult : null,
  }, { status: success ? 200 : 402 });
}
