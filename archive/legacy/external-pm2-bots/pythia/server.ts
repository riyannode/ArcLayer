/**
 * Pythia - The Oracle.
 * Serves trading signals behind x402 paywall.
 * Each signal costs 0.01 USDC. Payment settled on Arc Testnet.
 */

import * as dotenv from 'dotenv';
import express from 'express';
import { generateSignal } from './logic.js';
import { resolveIgniaWithPythia } from './resolver.js';
import { createA2ARouter } from './a2a-routes.js';
import { getLatestMarketId, readMarket } from '../shared/ignia.js';
import { recordInteraction } from '../contracts/a2a-client.js';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, toBytes } from 'viem';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = Number(process.env.PYTHIA_PORT ?? 4001);
const SELLER_ADDRESS = process.env.PYTHIA_SELLER_ADDRESS ?? '0x4aA3402575b6D98EacE35A823EFa267F7365bdD2';
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'https://arclayers.xyz';
// x402 exact amount uses atomic USDC units. 10000 = 0.01 USDC (6 decimals).
const PRICE_PER_SIGNAL = '10000';
const PRICE_PER_SIGNAL_DISPLAY = '0.01';
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const REPUTATION_ORACLE_KEY = process.env.PYTHIA_ORACLE_PRIVATE_KEY as `0x${string}` | undefined;

// Load agent-ids.json so we can record on-chain reputation per signal served.
const __serverDir = dirname(fileURLToPath(import.meta.url));
const AGENT_IDS_PATH = join(__serverDir, '..', 'contracts', 'agent-ids.json');
let pythiaAgentId: `0x${string}` | null = null;
let hermesAgentId: `0x${string}` | null = null;
try {
  if (existsSync(AGENT_IDS_PATH)) {
    const ids = JSON.parse(readFileSync(AGENT_IDS_PATH, 'utf8')) as {
      pythia?: { agentId: `0x${string}` };
      hermes?: { agentId: `0x${string}` };
    };
    pythiaAgentId = ids.pythia?.agentId ?? null;
    hermesAgentId = ids.hermes?.agentId ?? null;
  }
} catch {
  /* non-fatal */
}

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

  if (!['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'].includes(token)) {
    return res.status(400).json({ error: 'Unsupported token. Use BTC, ETH, SOL, XRP, or DOGE.' });
  }

  const requirements = buildRequirements(token);
  const paymentHeader = req.header('x-payment');

  if (!paymentHeader) {
    return res.status(402).json({
      x402Version: 2,
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
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
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
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
    });

    if (!settleRes.ok) {
      const err = await settleRes.text();
      return res.status(402).json({ error: `Settle failed: ${err}` });
    }

    const settleJson: any = await settleRes.json();
    const txHash = settleJson.transaction ?? settleJson.txHash ?? null;

    if (nonce) servedNonces.add(nonce);

    // Generate signal (async — fetches Polymarket live data)
    const signal = await generateSignal(token);

    // ─── Record reputation on-chain (fire-and-forget) ───────────────
    if (REPUTATION_ORACLE_KEY && pythiaAgentId) {
      const buyerId = hermesAgentId ?? keccak256(toBytes(payload?.payload?.authorization?.from ?? 'unknown-buyer'));
      const receiptHash = keccak256(toBytes(`signal:${token}:${nonce ?? Date.now()}`));
      recordInteraction(REPUTATION_ORACLE_KEY, pythiaAgentId, buyerId, receiptHash, BigInt(PRICE_PER_SIGNAL), true)
        .then((repTx) => console.log(`[Pythia] Reputation recorded tx=${repTx}`))
        .catch((err) => console.warn(`[Pythia] Reputation write failed:`, err.message ?? err));
    }

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

app.use('/api/a2a', createA2ARouter());

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
    supportedTokens: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'],
  });
});

app.get('/ignia/market/:id?', async (req, res) => {
  try {
    const id = req.params.id ? BigInt(req.params.id) : await getLatestMarketId();
    const market = await readMarket(id);
    res.json({
      marketId: id.toString(),
      question: market.question,
      yesShares: market.yesShares.toString(),
      noShares: market.noShares.toString(),
      pool: market.pool.toString(),
      outcome: market.outcome,
      yesProbabilityPct: Number(market.yesProbabilityBps.toFixed(2)),
      resolutionDeadline: Number(market.resolutionDeadline),
      deadlineISO: new Date(Number(market.resolutionDeadline) * 1000).toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? String(err) });
  }
});

app.post('/ignia/resolve/:id', async (req, res) => {
  if (!REPUTATION_ORACLE_KEY) {
    return res.status(503).json({ error: 'PYTHIA_ORACLE_PRIVATE_KEY not configured' });
  }
  try {
    const marketId = BigInt(req.params.id);
    const dryRun = req.query.dryRun === 'true' || req.query.dry === '1';
    const result = await resolveIgniaWithPythia(REPUTATION_ORACLE_KEY, marketId, { dryRun });
    console.log(`[Pythia] Resolve marketId=${marketId} status=${result.status} outcome=${result.decision.outcome} tx=${result.txHash ?? '-'}`);
    res.json({
      ...result,
      decision: {
        ...result.decision,
        marketId: result.decision.marketId.toString(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`\n🔮 Pythia - Signal Oracle`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Port: ${PORT}`);
  console.log(`Seller: ${SELLER_ADDRESS}`);
  console.log(`Price: ${PRICE_PER_SIGNAL} USDC/signal`);
  console.log(`Facilitator: ${FACILITATOR_URL}`);
  console.log(`Oracle: ${REPUTATION_ORACLE_KEY ? 'configured' : 'NOT configured (set PYTHIA_ORACLE_PRIVATE_KEY)'}`);
  console.log(`Endpoints:`);
  console.log(`  GET  /signal/:token         (BTC|ETH|SOL) — x402 gated`);
  console.log(`  GET  /ignia/market/:id?     latest market state if id omitted`);
  console.log(`  POST /ignia/resolve/:id     oracle resolution (?dry=1 for dry-run)`);
  console.log(`  GET  /health`);
  console.log(`  GET  /stats`);
  console.log();
});
