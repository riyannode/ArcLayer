import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
} from './constants';

export interface X402PaymentPayload {
  scheme: 'arc-escrow';
  network: 'arc-testnet';
  chainId: number;
  txHash: string;
  requirementId?: string;
  resource?: string;
  jobId?: string;
  payer?: string;
  metadata?: Record<string, unknown>;
}

export interface X402ParseError {
  code: string;
  message: string;
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function normalizeTxHash(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  return /^0x[a-fA-F0-9]{64}$/.test(value) ? value.toLowerCase() : null;
}

export function normalizeAddress(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : null;
}

export function canonicalResource(pathOrUrl: string): string {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return '/';

  try {
    const url = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(raw, 'http://localhost');
    return url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`;
  } catch {
    const noQuery = raw.split('?')[0].split('#')[0] || '/';
    return noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
  }
}

export function normalizeScheme(input: unknown): 'arc-escrow' | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (value === 'arc-escrow' || value === 'arclayer-escrow' || value === 'exact') {
    return 'arc-escrow';
  }
  return null;
}

export function normalizeNetwork(input: unknown): 'arc-testnet' | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (value === 'arc-testnet' || value === 'eip155:5042002') {
    return 'arc-testnet';
  }
  return null;
}

function toPayload(input: Record<string, unknown>): X402PaymentPayload | null {
  const txHash = normalizeTxHash(
    input.txHash ?? input.transaction ?? (input.payment as Record<string, unknown> | undefined)?.txHash
  );
  if (!txHash) return null;

  const requirementId = typeof input.requirementId === 'string'
    ? input.requirementId
    : typeof (input.extra as Record<string, unknown> | undefined)?.requirementId === 'string'
      ? ((input.extra as Record<string, unknown>).requirementId as string)
      : undefined;

  const resource = typeof input.resource === 'string'
    ? canonicalResource(input.resource)
    : typeof (input.payment as Record<string, unknown> | undefined)?.resource === 'string'
      ? canonicalResource((input.payment as Record<string, unknown>).resource as string)
      : undefined;

  const jobIdValue = input.jobId ?? (input.extra as Record<string, unknown> | undefined)?.jobId;
  const jobId = jobIdValue == null ? undefined : String(jobIdValue);

  const payer = normalizeAddress(input.payer ?? (input.payment as Record<string, unknown> | undefined)?.payer) ?? undefined;
  const scheme = normalizeScheme(input.scheme ?? (input.payment as Record<string, unknown> | undefined)?.scheme) ?? 'arc-escrow';
  const network = normalizeNetwork(input.network ?? (input.payment as Record<string, unknown> | undefined)?.network) ?? ARC_TESTNET_NETWORK;
  const chainIdRaw = input.chainId ?? (input.payment as Record<string, unknown> | undefined)?.chainId;
  const chainId = typeof chainIdRaw === 'number' ? chainIdRaw : Number(chainIdRaw ?? ARC_TESTNET_CHAIN_ID);

  return {
    scheme,
    network,
    chainId,
    txHash,
    requirementId,
    resource,
    jobId,
    payer,
    metadata: typeof input.metadata === 'object' && input.metadata !== null
      ? (input.metadata as Record<string, unknown>)
      : undefined,
  };
}

export function parsePaymentHeader(value: string | null): X402PaymentPayload | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const rawTxHash = normalizeTxHash(trimmed);
  if (rawTxHash) {
    return {
      scheme: 'arc-escrow',
      network: ARC_TESTNET_NETWORK,
      chainId: ARC_TESTNET_CHAIN_ID,
      txHash: rawTxHash,
    };
  }

  const candidates: string[] = [trimmed];
  try {
    candidates.push(fromBase64Url(trimmed));
  } catch {}

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const payload = toPayload(parsed);
      if (payload) return payload;
    } catch {}
  }

  return null;
}

export function validatePaymentPayload(
  payload: X402PaymentPayload | null,
  opts?: { resource?: string; requirementId?: string }
): { ok: true; payment: X402PaymentPayload } | { ok: false; error: X402ParseError } {
  if (!payload) {
    return { ok: false, error: { code: 'INVALID_PAYMENT', message: 'Missing or invalid payment payload' } };
  }

  if (payload.chainId !== ARC_TESTNET_CHAIN_ID) {
    return { ok: false, error: { code: 'INVALID_CHAIN', message: `Unsupported chainId ${payload.chainId}` } };
  }

  if (payload.scheme !== 'arc-escrow') {
    return { ok: false, error: { code: 'INVALID_SCHEME', message: `Unsupported scheme ${payload.scheme}` } };
  }

  if (payload.network !== ARC_TESTNET_NETWORK) {
    return { ok: false, error: { code: 'INVALID_NETWORK', message: `Unsupported network ${payload.network}` } };
  }

  if (!normalizeTxHash(payload.txHash)) {
    return { ok: false, error: { code: 'INVALID_TX_HASH', message: 'Invalid txHash' } };
  }

  if (opts?.resource && payload.resource && canonicalResource(payload.resource) !== canonicalResource(opts.resource)) {
    return { ok: false, error: { code: 'RESOURCE_MISMATCH', message: 'Payment resource does not match request resource' } };
  }

  if (opts?.requirementId && payload.requirementId && payload.requirementId !== opts.requirementId) {
    return { ok: false, error: { code: 'REQUIREMENT_MISMATCH', message: 'Payment requirementId does not match request requirementId' } };
  }

  return { ok: true, payment: payload };
}
