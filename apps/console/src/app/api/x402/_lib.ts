import { NextResponse } from 'next/server';
import {
  getBatchFacilitatorClient,
  isBatchPayment,
  parseExactVerifyRequest,
  recordGatewayPayment,
  deriveGatewayPaymentId,
  settleExactPayment,
  verifyExactEvmPayment,
  X402_VERSION_V2,
} from '@/lib/x402';
import type { PaymentPayload, PaymentRequirements } from '@/lib/x402';
import { enforceRailHeader } from '@/lib/x402/rail-enforce';

export const runtime = 'nodejs';

type ParsedOk = {
  ok: true;
  mode: 'gateway' | 'native';
  paymentPayload: PaymentPayload | Record<string, unknown>;
  paymentRequirements: PaymentRequirements | Record<string, unknown>;
};
type ParsedErr = { ok: false; status: number; body: Record<string, unknown> };
type Parsed = ParsedOk | ParsedErr;

export type DualVerifyResult = {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  [key: string]: unknown;
};

function isGatewayRail(paymentPayload: unknown, paymentRequirements: unknown): boolean {
  const req = paymentRequirements as { extra?: { transferMethod?: unknown } } | null;
  return req?.extra?.transferMethod === 'gateway-batched-eip3009' || isBatchPayment(paymentPayload as Record<string, unknown>);
}

export async function parseDualPaymentRequest(req: Request): Promise<Parsed> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, body: { ok: false, error: 'invalid_json', message: 'Request body must be JSON.' } };
  }

  const raw = body as Record<string, unknown>;
  if (raw.x402Version !== X402_VERSION_V2) {
    return { ok: false, status: 400, body: { ok: false, error: 'unsupported_version', message: 'x402Version 2 is required.' } };
  }

  const paymentPayload = raw.paymentPayload;
  const paymentRequirements = raw.paymentRequirements;
  if (!paymentPayload || !paymentRequirements) {
    return { ok: false, status: 400, body: { ok: false, error: 'missing_parameters', message: 'paymentPayload and paymentRequirements are required.' } };
  }

  const mode = isGatewayRail(paymentPayload, paymentRequirements) ? 'gateway' : 'native';
  if (mode === 'gateway') {
    return { ok: true, mode, paymentPayload: paymentPayload as Record<string, unknown>, paymentRequirements: paymentRequirements as Record<string, unknown> };
  }

  const parsed = parseExactVerifyRequest(body);
  if (!parsed.ok) {
    return { ok: false, status: parsed.status, body: { ok: false, error: parsed.reason, message: parsed.message } };
  }

  return { ok: true, mode, paymentPayload: parsed.paymentPayload, paymentRequirements: parsed.paymentRequirements };
}

async function verifyParsedPayment(parsed: ParsedOk): Promise<DualVerifyResult> {
  if (parsed.mode === 'gateway') {
    const facilitator = getBatchFacilitatorClient();
    return facilitator.verify(
      parsed.paymentPayload as unknown as Parameters<typeof facilitator.verify>[0],
      parsed.paymentRequirements as unknown as Parameters<typeof facilitator.verify>[1],
    ) as Promise<DualVerifyResult>;
  }

  return verifyExactEvmPayment({
    paymentPayload: parsed.paymentPayload as PaymentPayload,
    paymentRequirements: parsed.paymentRequirements as PaymentRequirements,
  }) as Promise<DualVerifyResult>;
}

export async function verifyDualPayment(req: Request) {
  const railError = await enforceRailHeader(req);
  if (railError) {
    return { response: railError } as const;
  }

  const parsed = await parseDualPaymentRequest(req);
  if (!parsed.ok) {
    return { parsed, response: NextResponse.json(parsed.body, { status: parsed.status }) } as const;
  }

  const result = await verifyParsedPayment(parsed);
  return { parsed, result } as const;
}

export async function settleDualPayment(req: Request) {
  const railError = await enforceRailHeader(req);
  if (railError) {
    return { response: railError } as const;
  }

  const parsed = await parseDualPaymentRequest(req);
  if (!parsed.ok) {
    return { parsed, response: NextResponse.json(parsed.body, { status: parsed.status }) } as const;
  }

  const result = await verifyParsedPayment(parsed);
  if (!result.isValid) return { parsed, result };

  if (parsed.mode === 'gateway') {
    const facilitator = getBatchFacilitatorClient();
    const requirements = parsed.paymentRequirements as unknown as Parameters<typeof facilitator.settle>[1];
    const proof = parsed.paymentPayload as unknown as Parameters<typeof facilitator.settle>[0];
    const settleResult = await facilitator.settle(proof, requirements);

    if (settleResult.success) {
      await recordGatewayPayment({
        paymentId: deriveGatewayPaymentId(proof as unknown as Record<string, unknown>, requirements as unknown as Record<string, unknown>),
        payer: settleResult.payer ?? result.payer ?? 'unknown',
        amount: String((requirements as { amount?: unknown }).amount ?? ''),
        network: String((requirements as { network?: unknown }).network ?? ''),
        transaction: settleResult.transaction ?? null,
        resource: String(((parsed.paymentPayload as Record<string, unknown>).resource as { url?: unknown } | undefined)?.url ?? '/api/x402'),
        status: 'settled',
      }).catch(() => undefined);
    }

    return { parsed, result, settleResult };
  }

  const settleResult = await settleExactPayment({
    paymentPayload: parsed.paymentPayload as PaymentPayload,
    paymentRequirements: parsed.paymentRequirements as PaymentRequirements,
    selfHosted: true,
  });
  return { parsed, result, settleResult };
}
