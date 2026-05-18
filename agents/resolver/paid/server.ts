/**
 * Paid Resolver endpoint.
 *
 * Public agents should buy from this Resolver, not directly from Oracle.
 * Oracle remains pure/internal and only emits raw signals.
 */
import express from 'express';
import { resolveSignals } from '../decision-engine.js';
import { fetchRawOracleSignals } from '../oracle-client.js';
import { toTradingSignal } from '../legacy-compat.js';

const app = express();
app.use(express.json());

const PORT = Number(process.env.APOLO_RESOLVER_PORT ?? process.env.RESOLVER_PORT ?? 4012);
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'https://arclayers.xyz';
const ORACLE_INTERNAL_URL = process.env.IGNIA_ORACLE_INTERNAL_URL ?? process.env.PYTHIA_ORACLE_INTERNAL_URL ?? 'http://localhost:4011';
const ORACLE_INTERNAL_KEY = process.env.IGNIA_ORACLE_INTERNAL_KEY ?? process.env.PYTHIA_ORACLE_INTERNAL_KEY;
const SELLER_ADDRESS = process.env.APOLO_RESOLVER_SELLER_ADDRESS ?? process.env.RESOLVER_SELLER_ADDRESS ?? process.env.PYTHIA_SELLER_ADDRESS ?? '0x4aA3402575b6D98EacE35A823EFa267F7365bdD2';
const PRICE_PER_DECISION = process.env.APOLO_RESOLVER_PRICE_ATOMIC ?? process.env.RESOLVER_PRICE_ATOMIC ?? '10000'; // 0.01 USDC
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';

type PaymentRequirements = {
  scheme: 'exact'; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number; resource: string; description: string; mimeType: string;
};

function buildRequirements(token: string): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'eip155:5042002',
    asset: USDC_ADDRESS,
    amount: PRICE_PER_DECISION,
    payTo: SELLER_ADDRESS,
    maxTimeoutSeconds: 300,
    resource: `resolver:signal:${token}`,
    description: `Resolved signal decision for ${token} from ArcLayer Resolver`,
    mimeType: 'application/json',
  };
}

function decodePayment(header: string): unknown {
  return JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
}

async function verifyAndSettle(paymentPayload: unknown, paymentRequirements: PaymentRequirements) {
  const verifyRes = await fetch(`${FACILITATOR_URL}/api/x402/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
  });
  const verify = await verifyRes.json().catch(async () => ({ ok: false, error: await verifyRes.text() }));
  if (!verifyRes.ok || verify.isValid === false || verify.ok === false) return { ok: false, status: 402, body: { error: 'verify_failed', verify } };

  const settleRes = await fetch(`${FACILITATOR_URL}/api/x402/settle`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
  });
  const settle = await settleRes.json().catch(async () => ({ ok: false, error: await settleRes.text() }));
  if (!settleRes.ok || settle.ok === false) return { ok: false, status: 402, body: { error: 'settle_failed', settle } };
  return { ok: true, verify, settle };
}

app.post('/signal/:token', async (req, res) => {
  const token = req.params.token.toUpperCase();
  const requirements = buildRequirements(token);
  const paymentHeader = req.header('x-payment') ?? req.header('X-PAYMENT');

  if (!paymentHeader) {
    return res.status(402).json({
      x402Version: 2,
      error: 'Payment required',
      accepts: [requirements],
      paymentRequirements: requirements,
      message: 'Buy resolved signal from Resolver. Oracle raw-signal layer is internal only.',
    });
  }

  let paymentPayload: unknown;
  try { paymentPayload = decodePayment(paymentHeader); }
  catch { return res.status(400).json({ ok: false, error: 'invalid_x_payment_header' }); }

  const paid = await verifyAndSettle(paymentPayload, requirements);
  if (!paid.ok) return res.status(paid.status).json(paid.body);

  const rawSignals = await fetchRawOracleSignals(token, req.body ?? {}, {
    oracleBaseUrl: ORACLE_INTERNAL_URL,
    internalKey: ORACLE_INTERNAL_KEY,
  });
  const decision = resolveSignals({ token, rawSignals });
  decision.payment = {
    amount: PRICE_PER_DECISION,
    asset: 'USDC',
    network: 'arc-testnet',
    txHash: paid.settle?.settle?.transaction ?? paid.settle?.settleResult?.transaction ?? paid.settle?.transaction ?? null,
    payer: paid.verify?.payer ?? paid.verify?.verify?.payer ?? null,
  };

  const paymentResponse = Buffer.from(JSON.stringify({ success: true, ...decision.payment, decisionId: decision.decisionId })).toString('base64url');
  res.setHeader('PAYMENT-RESPONSE', paymentResponse);
  res.json({ ok: decision.status === 'APPROVED', decision, signal: toTradingSignal(decision) });
});

app.get('/health', (_req, res) => res.json({ ok: true, agent: 'Apolo_Resolver', publicPaid: true, oracle: ORACLE_INTERNAL_URL }));

app.listen(PORT, () => console.log(`[Apolo Resolver] paid decision endpoint on :${PORT}`));
