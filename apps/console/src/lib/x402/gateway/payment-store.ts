import { createHash } from 'crypto';

export type GatewayPaymentStatus = 'verified' | 'accepted' | 'settled' | 'pending' | 'replayed';

export interface GatewayPaymentEvidence {
  paymentId: string;
  status: GatewayPaymentStatus;
  payer?: string;
  transaction?: string;
  network?: string;
  verifiedAt?: number;
  settledAt?: number;
  usedAt?: number;
  raw?: Record<string, unknown>;
}

const gatewayPayments = new Map<string, GatewayPaymentEvidence>();
const usedGatewayPayments = new Set<string>();

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function deriveGatewayPaymentId(paymentPayload: unknown, paymentRequirements: unknown): string {
  const encoded = stableStringify({ paymentPayload, paymentRequirements });
  return createHash('sha256').update(`gateway:x402:${encoded}`).digest('hex');
}

export function recordGatewayPayment(evidence: GatewayPaymentEvidence): GatewayPaymentEvidence {
  const previous = gatewayPayments.get(evidence.paymentId);
  const merged: GatewayPaymentEvidence = { ...previous, ...evidence };
  gatewayPayments.set(evidence.paymentId, merged);
  return merged;
}

export function getGatewayPayment(paymentId: string): GatewayPaymentEvidence | undefined {
  return gatewayPayments.get(paymentId);
}

export function consumeGatewayPayment(paymentId: string): { ok: true; evidence: GatewayPaymentEvidence } | { ok: false; reason: 'missing' | 'replayed'; evidence?: GatewayPaymentEvidence } {
  const evidence = gatewayPayments.get(paymentId);
  if (!evidence) return { ok: false, reason: 'missing' };
  if (usedGatewayPayments.has(paymentId)) return { ok: false, reason: 'replayed', evidence };
  usedGatewayPayments.add(paymentId);
  evidence.usedAt = Date.now();
  gatewayPayments.set(paymentId, evidence);
  return { ok: true, evidence };
}

export function gatewayEvidenceSummary() {
  return {
    stored: gatewayPayments.size,
    used: usedGatewayPayments.size,
    payments: Array.from(gatewayPayments.values()).slice(-20),
  };
}
