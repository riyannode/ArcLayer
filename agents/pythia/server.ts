/**
 * Pythia - The Oracle.
 * Serves trading signals behind x402 paywall.
 * Each signal costs 0.01 USDC. Payment settled on Arc Testnet.
 */

import * as dotenv from 'dotenv';
import express from 'express';
import { generateSignal } from './logic.js';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = Number(process.env.PYTHIA_PORT ?? 4001);
const SELLER_ADDRESS = process.env.PYTHIA_SELLER_ADDRESS ?? '0x3DC78013A70d9E0d1047902f5DCB50aeF68B003b';
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'https://arclayers.xyz';
const PRICE_PER_SIGNAL = '0.01';
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';

interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource: string;
  description: string;
  mimeType?: string;
}

function buildRequirements(token: string): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'eip155:5042002',
    asset: USDC_ADDRESS,
    amount: PRICE_PER_SIGNAL,
    payTo: SELLER_ADDRESS,
    maxTimeoutSeconds: 300,
    resource: `pythia:signal:${token}`,
    description: `Trading signal for ${token} from Pythia oracle`,
    mimeType: 'application/json',
  };
}

const servedNonces = new Set<string>();

app.get('/signal/:token', async (req, res) => {
  const token = req.params.token.toUpperCase();

  if (!['BTC', 'ETH', 'SOL'].includes(token)) {
    return res.status(400).json({ error: 'Unsupported token. Use BTC, ETH, or SOL.' });
  }

  const requirements = buildRequirements(token);
  const paymentHeader = req.header('x-payment');

  if (!paymentHeader) {
    return res.status(402).json({
      x402Version: 1,
      paymentRequirements: requirements,
      accepts: [requirements],
      error: 'Payment required',
    });
  }

  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(paymentHeader, 'base64url').toString());
  } catch {
    return res.status(400).json({ error: 'Invalid X-PAYMENT header' });
  }

  const nonce = payload?.payload?.authorization?.nonce;
  if (nonce && servedNonces.has(nonce)) {
    return res.status(409).json({ error: 'Payment nonce already used (replay rejected)' });
  }

  try {
    // Verify via facilitator
    const verifyRes = await fetch(`${FACILITATOR_URL}/api/x402/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentPayload: payload, paymentRequirements: requirements }),
    });

    if (!verifyRes.ok) {
      const err = await verifyRes.text();
      return res.status(402).json({ error: `Verify failed: ${err}` });
    }

    const verifyJson: any = await verifyRes.json();
    if (verifyJson.isValid === false) {
      return res.status(402).json({ error: verifyJson.invalidReason ?? 'Invalid payment' });
    }

    // Settle via facilitator
    const settleRes = await fetch(`${FACILITATOR_URL}/api/x402/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentPayload: payload, paymentRequirements: requirements }),
    });

    if (!settleRes.ok) {
      const err = await settleRes.text();
      return res.status(402).json({ error: `Settle failed: ${err}` });
    }

    const settleJson: any = await settleRes.json();
    const txHash = settleJson.transaction ?? settleJson.txHash ?? null;

    if (nonce) servedNonces.add(nonce);

    // Generate signal
    const signal = generateSignal(token);

    // PAYMENT-RESPONSE header
    const responsePayload = Buffer.from(
      JSON.stringify({ success: true, txHash, network: 'eip155:5042002', amount: PRICE_PER_SIGNAL, timestamp: Date.now() })
    ).toString('base64url');
    res.setHeader('PAYMENT-RESPONSE', responsePayload);

    console.log(`[Pythia] Signal served | token=${token} signal=${signal.signal} confidence=${signal.confidence} payer=${payload.payload?.authorization?.from ?? 'unknown'} tx=${txHash}`);

    return res.json({
      ...signal,
      payment: { amount: PRICE_PER_SIGNAL, asset: 'USDC', network: 'arc-testnet', txHash },
    });
  } catch (err: any) {
    console.error('[Pythia] Error:', err.message ?? err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    agent: 'Pythia',
    role: 'signal-oracle',
    network: 'arc-testnet',
    seller: SELLER_ADDRESS,
    pricePerSignal: PRICE_PER_SIGNAL,
    facilitator: FACILITATOR_URL,
    nonceCount: servedNonces.size,
    uptime: process.uptime(),
  });
});

app.get('/stats', (_req, res) => {
  res.json({
    signalsServed: servedNonces.size,
    revenue: (servedNonces.size * Number(PRICE_PER_SIGNAL)).toFixed(2) + ' USDC',
    supportedTokens: ['BTC', 'ETH', 'SOL'],
  });
});

app.listen(PORT, () => {
  console.log(`\n🔮 Pythia - Signal Oracle`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Port: ${PORT}`);
  console.log(`Seller: ${SELLER_ADDRESS}`);
  console.log(`Price: ${PRICE_PER_SIGNAL} USDC/signal`);
  console.log(`Facilitator: ${FACILITATOR_URL}`);
  console.log(`Endpoints:`);
  console.log(`  GET /signal/:token  (BTC|ETH|SOL) — x402 gated`);
  console.log(`  GET /health`);
  console.log(`  GET /stats`);
  console.log();
});
