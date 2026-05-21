import { NextRequest, NextResponse } from 'next/server';
import { arcTestnet } from '@arclayer/sdk';
import { runAgent } from '@/lib/agentExecutor';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { sanitizeErrorMessage } from '@/lib/sanitize-error';
import { withX402 } from '@/lib/x402';

export const runtime = 'nodejs';

const X402_FACILITATOR_DISABLED = process.env.X402_FACILITATOR_ENABLED === 'false';
const DEFAULT_AMOUNT_ATOMIC = '1'; // 0.000001 USDC, 6 decimals

function isValidAgentRouteId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

async function runPaidAgent(req: NextRequest, agentId: string) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const paymentResponse = req.headers.get('PAYMENT-RESPONSE');

  const inputRaw = body.input ?? body.prompt ?? null;
  const inputStr =
    typeof inputRaw === 'string'
      ? inputRaw
      : inputRaw == null
        ? ''
        : JSON.stringify(inputRaw);

  const MAX_INPUT_LENGTH = 2000;
  if (inputStr.length > MAX_INPUT_LENGTH) {
    return NextResponse.json(
      { error: 'input_too_long', message: `Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters (got ${inputStr.length}).` },
      { status: 400 },
    );
  }

  let payment: Record<string, unknown> = {};
  try {
    if (paymentResponse) payment = JSON.parse(Buffer.from(paymentResponse, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    payment = {};
  }

  // M2 fix: strict payment-mode allowlist. Reject unknown values rather than
  // silently falling back to 'arc-native' (which masked spoofed payment metadata).
  const ALLOWED_MODES = ['arc-native', 'circle-gateway'] as const;
  type Mode = typeof ALLOWED_MODES[number];
  const rawMode = typeof payment.mode === 'string' ? payment.mode : 'arc-native';
  if (!ALLOWED_MODES.includes(rawMode as Mode)) {
    return NextResponse.json(
      { error: 'invalid_payment_mode', message: `payment.mode must be one of: ${ALLOWED_MODES.join(', ')}` },
      { status: 400 },
    );
  }
  const paymentMode: Mode = rawMode as Mode;

  try {
    const result = await runAgent({
      agentId,
      jobId: typeof body.jobId === 'string' ? body.jobId : agentId,
      payer: typeof payment.payer === 'string' ? payment.payer : 'unknown',
      input: inputStr || `(no input provided - agent #${agentId} acknowledges payment)`,
    });

    return NextResponse.json({
      ok: true,
      cached: false,
      agentId,
      run: {
        status: 'completed',
        output: result.output,
        model: result.model,
        tokensUsed: result.tokensUsed,
        latencyMs: result.latencyMs,
        completedAt: Date.now(),
      },
      payment: {
        provider: paymentMode,
        status: 'settled',
        chainId: arcTestnet.id,
        txHash: payment.transaction ?? null,
        payer: payment.payer ?? null,
        amount: payment.amount ?? DEFAULT_AMOUNT_ATOMIC,
        paymentId: payment.paymentId ?? payment.paymentIdentifier ?? null,
        network: payment.network ?? null,
      },
    });
  } catch (err) {
    const msg = sanitizeErrorMessage(err);
    return NextResponse.json(
      {
        ok: false,
        cached: false,
        agentId,
        run: { status: 'failed', error: msg, completedAt: Date.now() },
        payment: {
          provider: paymentMode,
          status: 'settled',
          chainId: arcTestnet.id,
          txHash: payment.transaction ?? null,
          payer: payment.payer ?? null,
          amount: payment.amount ?? DEFAULT_AMOUNT_ATOMIC,
          paymentId: payment.paymentId ?? payment.paymentIdentifier ?? null,
          network: payment.network ?? null,
        },
      },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = getClientIp(req);
  const rateLimit = checkRateLimit(ip);

  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded', message: 'Too many requests. Try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))),
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
        },
      },
    );
  }

  const agentId = params.id;
  if (!isValidAgentRouteId(agentId)) {
    return NextResponse.json(
      { error: 'invalid_agent_id', message: 'Agent ID must be 1-64 alphanumeric, dash, or underscore characters.' },
      { status: 400 },
    );
  }

  if (X402_FACILITATOR_DISABLED) {
    return NextResponse.json(
      { error: 'x402_facilitator_disabled', message: 'X402 facilitator is required for this route.' },
      { status: 503 },
    );
  }

  return withX402(
    (paidReq) => runPaidAgent(paidReq, agentId),
    {
      amount: process.env.X402_AGENT_RUN_AMOUNT_ATOMIC || DEFAULT_AMOUNT_ATOMIC,
      resource: `/api/agents/${agentId}/run`,
      description: `Run ArcLayer agent ${agentId}`,
    },
  )(req);
}
