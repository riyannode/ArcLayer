/**
 * Pythia A2A endpoints — agent discovery, receipt generation, reputation hooks.
 * Mounted on Pythia's express app as /api/a2a/*
 */
import { Router, type Request, type Response } from 'express';
import { createSignedReceipt, type SignalPayload } from '../shared/a2a-receipt.js';
import { Rail } from '../contracts/a2a-client.js';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address } from 'viem';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AGENT_IDS_PATH = join(__dirname, '..', 'contracts', 'agent-ids.json');
const PRIVATE_KEY = process.env.PYTHIA_ORACLE_PRIVATE_KEY as `0x${string}` | undefined;
const RECEIPT_REGISTRY = process.env.A2A_RECEIPT_REGISTRY_ADDRESS ?? '0x5F591465D0C2fe20A28D2539dFBB2B00716397B7';

interface AgentIds {
  pythia?: { agentId: string; address: string };
  hermes?: { agentId: string; address: string };
  resolver?: { agentId: string; address: string };
}

function loadAgentIds(): AgentIds {
  if (!existsSync(AGENT_IDS_PATH)) return {};
  return JSON.parse(readFileSync(AGENT_IDS_PATH, 'utf8'));
}

// In-memory receipt store (for demo; production would use DB)
const receiptStore: Map<string, any> = new Map();

export function createA2ARouter(): Router {
  const router = Router();
  const agentIds = loadAgentIds();

  // ─── Agent Card (A2A discovery) ─────────────────────────────────────
  router.get('/agent-card', (_req: Request, res: Response) => {
    res.json({
      name: 'Pythia',
      version: '1.0.0',
      agentId: agentIds.pythia?.agentId ?? null,
      roles: ['MARKET_DATA', 'ORACLE'],
      capabilities: [
        'signal:BTC', 'signal:ETH', 'signal:SOL', 'signal:XRP', 'signal:DOGE',
        'resolve:ignia-market',
      ],
      endpoints: {
        signal: '/signal/:token',
        resolve: '/ignia/resolve/:id',
        receipt: '/api/a2a/receipt',
        health: '/health',
        stats: '/stats',
      },
      payment: {
        scheme: 'exact',
        network: 'eip155:5042002',
        asset: '0x3600000000000000000000000000000000000000',
        amount: '10000',
        payTo: agentIds.pythia?.address ?? process.env.PYTHIA_SELLER_ADDRESS,
      },
      registry: {
        contract: '0xB263336055dD65FF501e36CA39941760D943703C',
        network: 'eip155:5042002',
      },
    });
  });

  // ─── Generate receipt for a completed signal purchase ────────────────
  router.post('/receipt', async (req: Request, res: Response) => {
    if (!PRIVATE_KEY) {
      return res.status(503).json({ error: 'Provider key not configured' });
    }
    if (!agentIds.pythia?.agentId) {
      return res.status(503).json({ error: 'Pythia agentId not registered' });
    }

    const { signal, buyerAgentId, buyerAddress, paymentRef, tradeTx } = req.body;
    if (!signal || !buyerAgentId || !buyerAddress || !paymentRef) {
      return res.status(400).json({ error: 'Missing: signal, buyerAgentId, buyerAddress, paymentRef' });
    }

    try {
      // Set env for receipt registry address
      process.env.A2A_RECEIPT_REGISTRY_ADDRESS = RECEIPT_REGISTRY;

      const receipt = await createSignedReceipt(
        PRIVATE_KEY,
        agentIds.pythia.agentId as `0x${string}`,
        buyerAgentId as `0x${string}`,
        signal as SignalPayload,
        buyerAddress as Address,
        BigInt(signal.amount ?? 10000),
        paymentRef as `0x${string}`,
        (tradeTx ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
        Rail.ARC_NATIVE,
      );

      // Store locally
      receiptStore.set(receipt.receiptHash, receipt);

      console.log(`[Pythia A2A] Receipt generated: ${receipt.receiptHash} buyer=${buyerAgentId.slice(0, 10)}...`);

      res.json({
        receipt: {
          ...receipt,
          amount: receipt.amount.toString(),
          timestamp: receipt.timestamp.toString(),
        },
        anchorReady: true,
        registryAddress: RECEIPT_REGISTRY,
      });
    } catch (err: any) {
      console.error('[Pythia A2A] receipt error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Get stored receipt ─────────────────────────────────────────────
  router.get('/receipt/:hash', (req: Request, res: Response) => {
    const receipt = receiptStore.get(req.params.hash);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json({
      ...receipt,
      amount: receipt.amount.toString(),
      timestamp: receipt.timestamp.toString(),
    });
  });

  // ─── List all receipts ──────────────────────────────────────────────
  router.get('/receipts', (_req: Request, res: Response) => {
    const all = Array.from(receiptStore.entries()).map(([hash, r]) => ({
      receiptHash: hash,
      buyerAgentId: r.buyerAgentId,
      amount: r.amount.toString(),
      timestamp: r.timestamp.toString(),
      rail: r.rail,
    }));
    res.json({ count: all.length, receipts: all });
  });

  // ─── Reputation query (read from on-chain) ─────────────────────────
  router.get('/reputation', async (_req: Request, res: Response) => {
    if (!agentIds.pythia?.agentId) {
      return res.status(503).json({ error: 'agentId not registered' });
    }
    try {
      // Lazy import to avoid circular deps
      const { getStats, getReputation } = await import('../contracts/a2a-client.js');
      const agentId = agentIds.pythia.agentId as `0x${string}`;
      const [score, stats] = await Promise.all([
        getReputation(agentId),
        getStats(agentId),
      ]);
      res.json({
        agentId,
        reputationScore: score.toString(),
        stats: {
          callsServed: Number((stats as any).callsServed ?? (stats as any)[0] ?? 0),
          callsFailed: Number((stats as any).callsFailed ?? (stats as any)[1] ?? 0),
          signalsCorrect: Number((stats as any).signalsCorrect ?? (stats as any)[2] ?? 0),
          signalsWrong: Number((stats as any).signalsWrong ?? (stats as any)[3] ?? 0),
          cumulativePnlBps: ((stats as any).cumulativePnlBps ?? (stats as any)[4] ?? 0n).toString(),
          totalRevenue: ((stats as any).totalRevenue ?? (stats as any)[6] ?? 0n).toString(),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
