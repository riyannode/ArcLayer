import { humanJson } from '@/lib/api/human-json';
import { verifyDualPayment } from '../_lib';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let verified: Awaited<ReturnType<typeof verifyDualPayment>>;
  try {
    verified = await verifyDualPayment(req);
  } catch (error) {
    console.error('[x402/verify] payment verification failed', error);
    return humanJson(req, {
      ok: false,
      error: 'payment_verification_failed',
      message: 'Payment verification failed.',
    }, { status: 502 });
  }
  if ('response' in verified) return verified.response;

  return humanJson(req, {
    ok: verified.result.isValid,
    mode: verified.parsed.mode === 'gateway' ? 'x402-circle-gateway' : 'x402-native',
    ...verified.result,
  }, { status: verified.result.isValid ? 200 : 402 });
}
