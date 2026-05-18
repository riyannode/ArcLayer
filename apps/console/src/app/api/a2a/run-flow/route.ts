import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';

/**
 * POST /api/a2a/run-flow
 *
 * Runs ONE end-to-end A2A loop on demand and returns every receipt the UI needs:
 *
 *   Hermes ──pay 0.005 USDC (x402)──▶ Pythia
 *   Pythia ──signal payload──▶ Apolo
 *   Apolo  ──decision (filter)──▶ Hermes
 *   Apolo  ──reputation +1──▶ on-chain registry (settled job)
 *
 * The signal is real (proxied from /api/a2a/live-signal which scrapes
 * Polymarket Gamma + applies Apolo's filter). The payment + reputation
 * deltas are deterministic receipts — they're durable for the lifetime of
 * the Node process and survive client refresh, but they aren't on-chain
 * yet (Arc indexer wires up next milestone).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FlowReceipt = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  payAgent: {
    payer: string;
    payee: string;
    amountUsdc: string;
    nonce: string;
    paymentId: string;
    rail: 'x402';
    asset: 'USDC';
    chain: 'arc-testnet';
  };
  paymentCompleted: {
    receiptId: string;
    settledAt: string;
    txStatus: 'settled-offchain';
    arcscan: string | null;
  };
  workReceipt: {
    seller: 'Pythia';
    buyer: 'Hermes';
    payloadHash: string;
    payload: { asset: string; signal: string; confidence: number };
    issuedAt: string;
  };
  agentReputation: {
    agent: 'Apolo';
    role: 'Decision Filter';
    delta: number;
    score: number;
    rationale: string;
  };
  decision: {
    asset: string;
    decision: string;
    risk: string;
    confidence: number;
    status: 'APPROVED' | 'REJECTED';
  };
  hermesAction: {
    action: 'BUY_UP' | 'BUY_DOWN' | 'SKIP';
    sizeUsdc: string;
    mode: 'DRY_RUN';
  };
  error?: string;
};

// ── Tiny in-memory reputation store, keyed per process. ────────────────────
const g = globalThis as unknown as { __apoloReputation?: number };
function bumpApoloReputation(delta = 1): number {
  g.__apoloReputation = (g.__apoloReputation ?? 0) + delta;
  return g.__apoloReputation;
}

function nonceHex(): string {
  return '0x' + randomBytes(16).toString('hex');
}
function paymentIdFor(payer: string, payee: string, amount: string, nonce: string): string {
  return '0x' + createHash('sha256').update(`${payer}:${payee}:${amount}:${nonce}`).digest('hex').slice(0, 32);
}
function payloadHash(payload: object): string {
  return '0x' + createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

const HERMES = '0x4aa39A2C0bC3A9e4D62f3bE3aE2eFcc83a47BdD2';
const PYTHIA = '0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5';

export async function POST(req: Request) {
  const startedAt = new Date();
  try {
    const origin = new URL(req.url).origin;
    const sigRes = await fetch(`${origin}/api/a2a/live-signal`, { cache: 'no-store' });
    if (!sigRes.ok) throw new Error(`live-signal fetch failed: ${sigRes.status}`);
    const sigJson = (await sigRes.json()) as { rows?: any[] };
    const row = sigJson.rows?.[0];
    if (!row) {
      const finishedAt = new Date();
      return NextResponse.json(
        {
          ok: false,
          error: 'no live signal available; Polymarket window may be paused',
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        },
        { status: 503 },
      );
    }

    // ── 1. Pay Agent (Hermes → Pythia, 0.005 USDC via x402) ─────────────
    const amountUsdc = '0.005';
    const nonce = nonceHex();
    const paymentId = paymentIdFor(HERMES, PYTHIA, amountUsdc, nonce);

    // ── 2. Payment Completed ────────────────────────────────────────────
    const settledAt = new Date().toISOString();
    const receiptId = '0x' + createHash('sha256').update(paymentId + settledAt).digest('hex').slice(0, 32);

    // ── 3. Work Receipt (signal payload from Pythia) ────────────────────
    const payload = {
      asset: row.asset,
      signal: row.ignia.rawSignal,
      confidence: row.ignia.confidence,
    };
    const workHash = payloadHash(payload);

    // ── 4. Apolo decision + reputation bump ─────────────────────────────
    const apoloApproved = row.apolo.status === 'APPROVED';
    const repDelta = apoloApproved ? 1 : 0;
    const repScore = bumpApoloReputation(repDelta);

    const finishedAt = new Date();
    const out: FlowReceipt = {
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      payAgent: {
        payer: HERMES,
        payee: PYTHIA,
        amountUsdc,
        nonce,
        paymentId,
        rail: 'x402',
        asset: 'USDC',
        chain: 'arc-testnet',
      },
      paymentCompleted: {
        receiptId,
        settledAt,
        txStatus: 'settled-offchain',
        arcscan: null,
      },
      workReceipt: {
        seller: 'Pythia',
        buyer: 'Hermes',
        payloadHash: workHash,
        payload,
        issuedAt: settledAt,
      },
      agentReputation: {
        agent: 'Apolo',
        role: 'Decision Filter',
        delta: repDelta,
        score: repScore,
        rationale: apoloApproved
          ? 'Apolo filtered the signal and approved an actionable decision'
          : 'Apolo rejected the signal — no reputation gained on rejected work',
      },
      decision: {
        asset: row.asset,
        decision: row.apolo.decision,
        risk: row.apolo.risk,
        confidence: row.apolo.confidence,
        status: row.apolo.status,
      },
      hermesAction: {
        action: row.hermes.action,
        sizeUsdc: row.hermes.sizeUsdc,
        mode: row.hermes.mode,
      },
    };
    return NextResponse.json(out);
  } catch (err: any) {
    const finishedAt = new Date();
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || 'flow failed',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    method: 'POST',
    description: 'Runs one end-to-end Hermes→Pythia→Apolo loop. Returns full receipts.',
    apoloReputationScore: g.__apoloReputation ?? 0,
  });
}
