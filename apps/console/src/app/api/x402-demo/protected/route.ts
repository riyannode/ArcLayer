import { NextRequest, NextResponse } from 'next/server';
import { getAddress } from 'viem';
import {
  ARC_TESTNET_CAIP2_NETWORK,
  USDC_ADDRESS,
  X402_VERSION_V2,
  verifyExactSettlementProof,
  type PaymentRequirements,
} from '@/lib/x402';

export const runtime = 'nodejs';

const DEFAULT_AMOUNT_ATOMIC = '10000'; // 0.01 USDC, 6 decimals
const DEFAULT_PAY_TO = '0x3DC78013A70d9E0d1047902f5DCB50aeF68B003b';

function receiver(): `0x${string}` {
  const configured = process.env.X402_RECEIVER_ADDRESS || process.env.X402_PAY_TO || DEFAULT_PAY_TO;
  return getAddress(configured) as `0x${string}`;
}

function buildPaymentRequirements(): PaymentRequirements {
  return {
    scheme: 'exact',
    network: ARC_TESTNET_CAIP2_NETWORK,
    asset: getAddress(USDC_ADDRESS) as `0x${string}`,
    amount: process.env.X402_DEMO_AMOUNT_ATOMIC || DEFAULT_AMOUNT_ATOMIC,
    payTo: receiver(),
    maxTimeoutSeconds: Number(process.env.X402_REQUIREMENT_TTL_SECONDS || '300'),
    extra: {
      name: 'USDC',
      version: '2',
      transferMethod: 'eip3009',
      decimals: 6,
      symbol: 'USDC',
    },
  };
}

function paymentRequiredResponse() {
  const requirements = buildPaymentRequirements();
  return NextResponse.json(
    {
      ok: false,
      error: 'payment_required',
      message: 'This resource requires x402 payment. Sign an EIP-3009 authorization, settle it on-chain, then retry with the payment proof in the X-PAYMENT header.',
      x402Version: X402_VERSION_V2,
      paymentRequirements: requirements,
      accepts: [requirements],
    },
    {
      status: 402,
      headers: {
        'X-402-Version': String(X402_VERSION_V2),
        'Content-Type': 'application/json',
      },
    },
  );
}

/**
 * Decode the payment header. Accepts:
 * - Raw JSON string (from browser demo)
 * - Base64 or base64url encoded JSON (canonical x402 clients)
 */
function decodePaymentHeader(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { return null; }
  }

  // Try base64/base64url
  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Extract payment payload from request headers.
 * Priority: X-PAYMENT > PAYMENT-SIGNATURE (X-PAYMENT is canonical per x402 spec)
 */
function extractPaymentProof(req: NextRequest) {
  const raw = req.headers.get('x-payment') || req.headers.get('payment-signature');
  if (!raw) return null;
  return decodePaymentHeader(raw);
}

export async function GET(req: NextRequest) {
  const requirements = buildPaymentRequirements();
  const proof = extractPaymentProof(req);

  if (!proof || typeof proof !== 'object') {
    return paymentRequiredResponse();
  }

  // The proof should be a PaymentPayload object with shape:
  // { x402Version, accepted, payload: { signature, authorization: {...} } }
  const pp = proof as Record<string, unknown>;
  const payload = pp.payload as Record<string, unknown> | undefined;
  const authorization = payload?.authorization as Record<string, unknown> | undefined;

  if (!payload?.signature || !authorization?.from || !authorization?.nonce) {
    return NextResponse.json(
      {
        ok: false,
        unlocked: false,
        error: 'invalid_payment_proof',
        message: 'Payment proof must include payload.signature and payload.authorization with from, to, value, validAfter, validBefore, nonce.',
        paymentRequirements: requirements,
      },
      { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // Verify the settlement proof on-chain
  const result = await verifyExactSettlementProof({
    paymentPayload: proof as Parameters<typeof verifyExactSettlementProof>[0]['paymentPayload'],
    paymentRequirements: requirements,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        unlocked: false,
        error: result.reason,
        message: result.message,
        paymentRequirements: requirements,
      },
      { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  return NextResponse.json({
    ok: true,
    message: 'ArcLayer x402 protected resource unlocked',
    payment: {
      payer: result.payer,
      txHash: result.txHash ?? null,
      amount: result.amount,
      nonce: result.nonce,
    },
    unlocked: true,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
