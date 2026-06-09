import { humanJson } from '@/lib/api/human-json';
import { settleDualPayment } from '../_lib';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const settled = await settleDualPayment(req);
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
