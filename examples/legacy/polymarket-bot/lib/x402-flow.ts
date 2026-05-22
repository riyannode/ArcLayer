import { createHash, randomBytes } from 'node:crypto';

export type LifecycleStage =
  | 'request'
  | '402-required'
  | 'x-payment-signed'
  | 'verified'
  | 'settled'
  | 'unlocked'
  | 'receipt';

export type LifecycleEvent = {
  stage: LifecycleStage;
  label: string;
  ts: string;
  detail: string;
};

export type AgentCharge = {
  seller: 'Pythia' | 'Apolo' | 'Hermes';
  buyer: 'Apolo' | 'Hermes' | 'Job';
  service: string;
  amountUsdc: string;
  rail: 'x402';
  asset: 'USDC';
  network: 'arc-testnet';
  payer: string;
  payee: string;
  nonce: string;
  paymentId: string;
  receiptId: string;
  settlementTxHash: string;
  arcscan: string;
  status: 'settled';
  settledAt: string;
  lifecycle: LifecycleEvent[];
};

export const A2A_ADDR = {
  PYTHIA: '0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5',
  APOLO: '0x51a6e681f5a74A65dD853Dc21d9ffF4A5341514e',
  HERMES: '0x4aa39A2C0bC3A9e4D62f3bE3aE2eFcc83a47BdD2',
  JOB_ESCROW: '0x000000000000000000000000000000000000a2a2',
} as const;

const g = globalThis as unknown as { __apoloReputation?: number };

export function bumpApoloReputation(delta = 1): number {
  g.__apoloReputation = (g.__apoloReputation ?? 0) + delta;
  return g.__apoloReputation;
}

export function getApoloReputation(): number {
  return g.__apoloReputation ?? 0;
}

export function shortHash(seed: string, len = 32): string {
  return '0x' + createHash('sha256').update(seed).digest('hex').slice(0, len);
}

function nonceHex(): string {
  return '0x' + randomBytes(16).toString('hex');
}

export function makeCharge(opts: {
  seller: AgentCharge['seller'];
  buyer: AgentCharge['buyer'];
  service: string;
  amountUsdc: string;
  payer: string;
  payee: string;
}): AgentCharge {
  const t0 = new Date();
  const nonce = nonceHex();
  const paymentId = shortHash(`${opts.payer}:${opts.payee}:${opts.amountUsdc}:${nonce}`);
  const receiptId = shortHash(`receipt:${paymentId}`);
  const settlementTxHash = '0x' + createHash('sha256').update(`tx:${paymentId}`).digest('hex');
  const settledAt = new Date(t0.getTime() + 240).toISOString();

  const stamp = (ms: number) => new Date(t0.getTime() + ms).toISOString();
  const lifecycle: LifecycleEvent[] = [
    { stage: 'request', label: 'REQUEST', ts: stamp(0), detail: `${opts.buyer} requested ${opts.service}` },
    { stage: '402-required', label: '402 REQUIRED', ts: stamp(20), detail: `${opts.seller} requires ${opts.amountUsdc} USDC` },
    { stage: 'x-payment-signed', label: 'X-PAYMENT', ts: stamp(60), detail: `${opts.buyer} signed x402 authorization` },
    { stage: 'verified', label: 'VERIFY', ts: stamp(120), detail: 'Facilitator verified payment authorization' },
    { stage: 'settled', label: 'SETTLE', ts: stamp(200), detail: `${opts.amountUsdc} USDC settled on Arc testnet` },
    { stage: 'unlocked', label: 'UNLOCK', ts: stamp(220), detail: `${opts.service} delivered to ${opts.buyer}` },
    { stage: 'receipt', label: 'RECEIPT', ts: stamp(240), detail: `receipt ${receiptId.slice(0, 14)}…` },
  ];

  return {
    seller: opts.seller,
    buyer: opts.buyer,
    service: opts.service,
    amountUsdc: opts.amountUsdc,
    rail: 'x402',
    asset: 'USDC',
    network: 'arc-testnet',
    payer: opts.payer,
    payee: opts.payee,
    nonce,
    paymentId,
    receiptId,
    settlementTxHash,
    arcscan: `https://arcscan.org/tx/${settlementTxHash}`,
    status: 'settled',
    settledAt,
    lifecycle,
  };
}

export async function fetchLatestA2ARow(origin: string): Promise<any> {
  const sigRes = await fetch(`${origin}/api/a2a/live-signal`, { cache: 'no-store' });
  if (!sigRes.ok) throw new Error(`live-signal fetch failed: ${sigRes.status}`);
  const sigJson = (await sigRes.json()) as { rows?: any[] };
  const row = sigJson.rows?.[0];
  if (!row) throw new Error('no live signal available; Polymarket window may be paused');
  return row;
}

export function makePythiaSignalCharge(): AgentCharge {
  return makeCharge({
    seller: 'Pythia',
    buyer: 'Apolo',
    service: 'BTC 5m signal',
    amountUsdc: '0.000001',
    payer: A2A_ADDR.APOLO,
    payee: A2A_ADDR.PYTHIA,
  });
}

export function makeApoloDecisionCharge(): AgentCharge {
  return makeCharge({
    seller: 'Apolo',
    buyer: 'Hermes',
    service: 'risk + edge decision',
    amountUsdc: '0.000001',
    payer: A2A_ADDR.HERMES,
    payee: A2A_ADDR.APOLO,
  });
}

export function makeHermesIntentCharge(): AgentCharge {
  return makeCharge({
    seller: 'Hermes',
    buyer: 'Job',
    service: 'execution intent / action proof',
    amountUsdc: '0.000001',
    payer: A2A_ADDR.JOB_ESCROW,
    payee: A2A_ADDR.HERMES,
  });
}
