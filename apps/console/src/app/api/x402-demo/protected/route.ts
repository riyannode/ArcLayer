import { NextRequest, NextResponse } from 'next/server';
import { getAddress } from 'viem';
import {
  ARC_TESTNET_CAIP2_NETWORK,
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_VERSION,
  GATEWAY_NETWORK_NAME,
  consumeGatewayPayment,
  deriveGatewayPaymentId,
  getArcTestnetGatewayConfig,
  getBatchFacilitatorClient,
  isBatchPayment,
  isGatewayEnabled,
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

function buildArcNativeRequirements(): PaymentRequirements {
  return {
    scheme: 'exact',
    network: ARC_TESTNET_CAIP2_NETWORK,
    asset: getAddress(USDC_ADDRESS) as `0x${string}`,
    amount: process.env.X402_DEMO_AMOUNT_ATOMIC || DEFAULT_AMOUNT_ATOMIC,
    payTo: receiver(),
    maxTimeoutSeconds: Number(process.env.X402_REQUIREMENT_TTL_SECONDS || '300'),
    extra: { name: 'USDC', version: '2', transferMethod: 'eip3009', decimals: 6, symbol: 'USDC' },
  };
}

function buildGatewayRequirements() {
  return {
    scheme: 'exact',
    network: GATEWAY_NETWORK_NAME,
    asset: getAddress(USDC_ADDRESS) as `0x${string}`,
    amount: process.env.X402_DEMO_AMOUNT_ATOMIC || DEFAULT_AMOUNT_ATOMIC,
    payTo: receiver(),
    maxTimeoutSeconds: Number(process.env.X402_REQUIREMENT_TTL_SECONDS || '300'),
    extra: {
      name: CIRCLE_BATCHING_NAME,
      version: CIRCLE_BATCHING_VERSION,
      verifyingContract: process.env.X402_GATEWAY_WALLET_ADDRESS || getArcTestnetGatewayConfig().gatewayWallet,
      supportedChain: GATEWAY_NETWORK_NAME,
      transferMethod: 'gateway-batched-eip3009',
      status: isGatewayEnabled() ? 'enabled' : 'integrating_disabled_until_e2e_succeeds',
    },
  };
}

function paymentRequiredResponse() {
  const arcNative = buildArcNativeRequirements();
  const gateway = buildGatewayRequirements();
  return NextResponse.json(
    {
      ok: false,
      error: 'payment_required',
      message: 'This resource requires x402 payment. Arc Native uses X-PAYMENT. Circle Gateway uses PAYMENT-SIGNATURE.',
      x402Version: X402_VERSION_V2,
      paymentRequirements: arcNative,
      accepts: [arcNative, gateway],
    },
    { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2), 'Content-Type': 'application/json' } },
  );
}

function decodePaymentHeader(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { return null; }
  }
  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch { return null; }
}

function encodePaymentResponse(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function extractPaymentProof(req: NextRequest): { proof: unknown; header: 'PAYMENT-SIGNATURE' | 'X-PAYMENT' } | null {
  const gatewayRaw = req.headers.get('payment-signature');
  if (gatewayRaw) return { proof: decodePaymentHeader(gatewayRaw), header: 'PAYMENT-SIGNATURE' };
  const arcRaw = req.headers.get('x-payment');
  if (arcRaw) return { proof: decodePaymentHeader(arcRaw), header: 'X-PAYMENT' };
  return null;
}

export async function GET(req: NextRequest) {
  const extracted = extractPaymentProof(req);
  if (!extracted?.proof || typeof extracted.proof !== 'object') return paymentRequiredResponse();

  const proof = extracted.proof as Record<string, unknown>;
  const accepted = (proof.accepted || proof.paymentRequirements) as Record<string, unknown> | undefined;
  const gatewayRequirements = buildGatewayRequirements();

  if (extracted.header === 'PAYMENT-SIGNATURE' || isBatchPayment(accepted)) {
    if (!isGatewayEnabled()) {
      return NextResponse.json(
        { ok: false, unlocked: false, error: 'gateway_mode_disabled', message: 'Circle Gateway supports Arc Testnet, but Gateway mode is disabled until ArcLayer E2E succeeds.', accepts: [buildArcNativeRequirements(), gatewayRequirements] },
        { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }

    try {
      const client = getBatchFacilitatorClient();
      const paymentId = deriveGatewayPaymentId(proof, gatewayRequirements);
      const consumed = consumeGatewayPayment(paymentId);
      if (!consumed.ok && consumed.reason === 'replayed') {
        return NextResponse.json(
          { ok: false, unlocked: false, error: 'gateway_payment_replayed', paymentId, accepts: [buildArcNativeRequirements(), gatewayRequirements] },
          { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }

      const verify = await client.verify(
        proof as unknown as Parameters<typeof client.verify>[0],
        gatewayRequirements as unknown as Parameters<typeof client.verify>[1],
      );
      if (!verify.isValid) {
        return NextResponse.json(
          { ok: false, unlocked: false, error: verify.invalidReason || 'gateway_verify_failed', paymentId, accepts: [buildArcNativeRequirements(), gatewayRequirements] },
          { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }

      const settle = await client.settle(
        proof as unknown as Parameters<typeof client.settle>[0],
        gatewayRequirements as unknown as Parameters<typeof client.settle>[1],
      ).catch((error) => ({ success: false, errorReason: 'gateway_settlement_pending', errorMessage: error instanceof Error ? error.message : String(error), transaction: '', network: GATEWAY_NETWORK_NAME, payer: verify.payer }));

      const paymentResponse = {
        success: true,
        mode: 'circle-gateway',
        paymentId,
        payer: settle.payer || verify.payer,
        transaction: settle.transaction || null,
        network: settle.network || GATEWAY_NETWORK_NAME,
        status: settle.success ? 'settled' : 'accepted_pending_settlement',
        settlementError: settle.success ? undefined : settle.errorReason,
      };
      return NextResponse.json(
        { ok: true, message: 'ArcLayer x402 protected resource unlocked', mode: 'circle-gateway', payment: paymentResponse, unlocked: true },
        { headers: { 'PAYMENT-RESPONSE': encodePaymentResponse(paymentResponse) } },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gateway unlock failed';
      return NextResponse.json(
        { ok: false, unlocked: false, error: 'gateway_error', message, accepts: [buildArcNativeRequirements(), gatewayRequirements] },
        { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  }

  const arcRequirements = buildArcNativeRequirements();
  const payload = proof.payload as Record<string, unknown> | undefined;
  const authorization = payload?.authorization as Record<string, unknown> | undefined;
  if (!payload?.signature || !authorization?.from || !authorization?.nonce) {
    return NextResponse.json(
      { ok: false, unlocked: false, error: 'invalid_payment_proof', message: 'Payment proof must include payload.signature and payload.authorization.', accepts: [arcRequirements, gatewayRequirements] },
      { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  const result = await verifyExactSettlementProof({
    paymentPayload: proof as unknown as Parameters<typeof verifyExactSettlementProof>[0]['paymentPayload'],
    paymentRequirements: arcRequirements,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, unlocked: false, error: result.reason, message: result.message, accepts: [arcRequirements, gatewayRequirements] },
      { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  const paymentResponse = { success: true, mode: 'arc-native', payer: result.payer, transaction: result.txHash ?? null, amount: result.amount, nonce: result.nonce };
  return NextResponse.json(
    { ok: true, message: 'ArcLayer x402 protected resource unlocked', mode: 'arc-native', payment: paymentResponse, unlocked: true },
    { headers: { 'PAYMENT-RESPONSE': encodePaymentResponse(paymentResponse) } },
  );
}

export async function POST(req: NextRequest) { return GET(req); }
