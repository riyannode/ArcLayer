import { NextResponse } from 'next/server';
import {
  getBatchFacilitatorClient,
  isBatchPayment,
  parseExactVerifyRequest,
  recordGatewayPayment,
  deriveGatewayPaymentId,
  claimGatewaySettlement,
  consumeGatewayPayment,
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
  return req?.extra?.transferMethod === 'gateway-batched-eip3009' || isBatchPayment(paymentRequirements as Record<string, unknown>);
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  return isRecord(body) ? body : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getRecordPath(source: Record<string, unknown>, path: string[]): Record<string, unknown> | null {
  let current: unknown = source;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return isRecord(current) ? current : null;
}

function collectExplicitModeHints(raw: Record<string, unknown>): unknown[] {
  const requirementsExtra = getRecordPath(raw, ['paymentRequirements', 'extra']);
  return [raw.mode, raw.rail, requirementsExtra?.rail, requirementsExtra?.mode].filter((value) => value !== undefined && value !== null);
}

function explicitMode(raw: Record<string, unknown>): 'gateway' | 'native' | 'invalid' | null {
  const hints = collectExplicitModeHints(raw);
  if (hints.length === 0) return null;

  const modes = new Set<'gateway' | 'native'>();
  for (const hint of hints) {
    if (typeof hint !== 'string') return 'invalid';
    const normalized = hint.trim().toLowerCase();
    if (normalized !== 'gateway' && normalized !== 'native') return 'invalid';
    modes.add(normalized);
  }

  return modes.size === 1 ? [...modes][0] : 'invalid';
}

export function parseDualPaymentBody(body: Record<string, unknown> | null): Parsed {
  if (!body) {
    return { ok: false, status: 400, body: { ok: false, error: 'invalid_json', message: 'Request body must be JSON.' } };
  }

  const raw = body;
  if (raw.x402Version !== X402_VERSION_V2) {
    return { ok: false, status: 400, body: { ok: false, error: 'unsupported_version', message: 'x402Version 2 is required.' } };
  }

  const paymentPayload = raw.paymentPayload;
  const paymentRequirements = raw.paymentRequirements;
  if (!paymentPayload || !paymentRequirements) {
    return { ok: false, status: 400, body: { ok: false, error: 'missing_parameters', message: 'paymentPayload and paymentRequirements are required.' } };
  }

  const detectedMode = isGatewayRail(paymentPayload, paymentRequirements) ? 'gateway' : 'native';
  const requestedMode = explicitMode(raw);
  if (requestedMode === 'invalid') {
    return { ok: false, status: 400, body: { ok: false, error: 'invalid_rail_mode', message: "Explicit x402 rail mode must be 'native' or 'gateway'." } };
  }
  if (requestedMode && requestedMode !== detectedMode) {
    return { ok: false, status: 400, body: { ok: false, error: 'rail_payload_mismatch', message: `Explicit x402 rail mode '${requestedMode}' does not match the payment payload.` } };
  }

  const mode = requestedMode ?? detectedMode;
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

export async function parseDualPaymentRequest(req: Request): Promise<Parsed> {
  return parseDualPaymentBody(await readJsonBody(req));
}

export async function verifyDualPayment(req: Request) {
  const body = await readJsonBody(req);
  const railError = await enforceRailHeader(req, body);
  if (railError) {
    return { response: railError } as const;
  }

  const parsed = parseDualPaymentBody(body);
  if (!parsed.ok) {
    return { parsed, response: NextResponse.json(parsed.body, { status: parsed.status }) } as const;
  }

  const result = await verifyParsedPayment(parsed);
  return { parsed, result } as const;
}

export async function settleDualPayment(req: Request) {
  const body = await readJsonBody(req);
  const railError = await enforceRailHeader(req, body);
  if (railError) {
    return { response: railError } as const;
  }

  const parsed = parseDualPaymentBody(body);
  if (!parsed.ok) {
    return { parsed, response: NextResponse.json(parsed.body, { status: parsed.status }) } as const;
  }

  const result = await verifyParsedPayment(parsed);
  if (!result.isValid) return { parsed, result };

  if (parsed.mode === 'gateway') {
    const facilitator = getBatchFacilitatorClient();
    const requirements = parsed.paymentRequirements as unknown as Parameters<typeof facilitator.settle>[1];
    const proof = parsed.paymentPayload as unknown as Parameters<typeof facilitator.settle>[0];
    const paymentId = deriveGatewayPaymentId(proof as unknown as Record<string, unknown>, requirements as unknown as Record<string, unknown>);
    const claim = await claimGatewaySettlement({
      paymentId,
      payer: result.payer,
      amount: String((requirements as { amount?: unknown }).amount ?? ''),
      network: String((requirements as { network?: unknown }).network ?? ''),
      payTo: String((requirements as { payTo?: unknown }).payTo ?? ''),
      asset: String((requirements as { asset?: unknown }).asset ?? ''),
      resource: String(((parsed.paymentPayload as Record<string, unknown>).resource as { url?: unknown } | undefined)?.url ?? '/api/x402'),
      raw: proof as unknown as Record<string, unknown>,
    });
    if (!claim.acquired) {
      return {
        parsed,
        result,
        settleResult: { success: false, errorReason: `payment_${claim.reason}`, transaction: null, payer: result.payer },
      };
    }
    let settleResult: Awaited<ReturnType<typeof facilitator.settle>>;
    try {
      settleResult = await facilitator.settle(proof, requirements);
    } catch (error) {
      await recordGatewayPayment({
        paymentId,
        payer: result.payer ?? 'unknown',
        amount: String((requirements as { amount?: unknown }).amount ?? ''),
        network: String((requirements as { network?: unknown }).network ?? ''),
        transaction: undefined,
        resource: String(((parsed.paymentPayload as Record<string, unknown>).resource as { url?: unknown } | undefined)?.url ?? '/api/x402'),
        status: 'failed',
      }).catch(() => undefined);
      throw error;
    }
    if (!settleResult.success) {
      await recordGatewayPayment({
        paymentId,
        payer: settleResult.payer ?? result.payer ?? 'unknown',
        amount: String((requirements as { amount?: unknown }).amount ?? ''),
        network: String((requirements as { network?: unknown }).network ?? ''),
        transaction: settleResult.transaction ?? null,
        resource: String(((parsed.paymentPayload as Record<string, unknown>).resource as { url?: unknown } | undefined)?.url ?? '/api/x402'),
        status: 'failed',
      }).catch(() => undefined);
    }

    if (settleResult.success) {
      await recordGatewayPayment({
        paymentId,
        payer: settleResult.payer ?? result.payer ?? 'unknown',
        amount: String((requirements as { amount?: unknown }).amount ?? ''),
        network: String((requirements as { network?: unknown }).network ?? ''),
        transaction: settleResult.transaction ?? null,
        resource: String(((parsed.paymentPayload as Record<string, unknown>).resource as { url?: unknown } | undefined)?.url ?? '/api/x402'),
        status: 'settled',
      }).catch(() => undefined);
      const consume = await consumeGatewayPayment(paymentId);
      if (!consume.ok) {
        return {
          parsed,
          result,
          settleResult: {
            success: false,
            errorReason: consume.reason === 'replayed' ? 'payment_replayed' : 'payment_missing_after_settle',
            transaction: settleResult.transaction ?? null,
            payer: settleResult.payer ?? result.payer,
          },
        };
      }
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
