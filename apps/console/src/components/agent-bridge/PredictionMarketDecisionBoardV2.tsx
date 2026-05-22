'use client';

import { useMemo } from 'react';
import type { BridgeEvent, BridgeReceipt, BridgeSession } from './types';
import { eventType, shortHash } from './types';
import { DecisionNodeCard, FlowEdge } from './PredictionDecisionNodes';

export type DecisionNode = {
  key: 'oracle' | 'receipt1' | 'risk' | 'receipt2' | 'evaluator' | 'receipt3' | 'executor';
  title: string;
  status: 'pending' | 'active' | 'completed' | 'rejected';
  accent: 'blue' | 'gold' | 'purple' | 'green' | 'red' | 'neutral';
  summary: string;
  fields: Array<[string, string]>;
  receiptType?: string;
  tx?: string;
  paymentReason?: string;
};

function latest(events: BridgeEvent[], f: (e: BridgeEvent) => boolean) { return events.filter(f).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null; }
const txt = (v: unknown) => v === null || v === undefined || v === '' ? '—' : String(v);

export function buildNodes(session: BridgeSession | null): DecisionNode[] {
  const events = session?.events ?? [];
  const receipts = session?.receipts ?? [];
  const oracle = latest(events, (e) => e.role === 'oracle' || eventType(e) === 'market_snapshot');
  const risk = latest(events, (e) => ['analyzer', 'risk_gate'].includes(e.role) || ['resolver_output', 'risk_output'].includes(eventType(e)));
  const evaluator = latest(events, (e) => e.role === 'evaluator' || eventType(e) === 'evaluation');
  const executor = latest(events, (e) => e.role === 'executor' || eventType(e) === 'execution_intent');

  const rec = (r: BridgeReceipt | undefined) => ({
    receiptType: r?.receipt_type,
    tx: r?.transaction || undefined,
    paymentReason: txt(r?.metadata?.summary || r?.metadata?.reason || r?.metadata?.payment_reason),
    fields: [
      ['receipt_type', txt(r?.receipt_type)],
      ['payload_hash', shortHash(r?.payload_hash)],
      ['tx', shortHash(r?.transaction)],
    ] as Array<[string, string]>,
  });

  const r1 = receipts.find((r) => r.payload_hash === oracle?.payload_hash) ?? receipts.find((r) => r.metadata?.role === 'oracle');
  const r2 = receipts.find((r) => r.payload_hash === risk?.payload_hash) ?? receipts.find((r) => ['analyzer', 'risk_gate'].includes(String(r.metadata?.role || '')));
  const r3 = receipts.find((r) => r.payload_hash === evaluator?.payload_hash) ?? receipts.find((r) => r.metadata?.role === 'evaluator');

  const riskRejected = Boolean(risk?.payload?.noTradeReason);
  const evalRejected = evaluator?.payload?.approved === false;
  const rejected = riskRejected || evalRejected;

  return [
    { key: 'oracle', title: 'ORACLE', status: oracle ? 'completed' : 'pending', accent: 'blue', summary: txt(oracle?.payload?.summary || 'market_snapshot / oracle role'), fields: [['payload_hash', shortHash(oracle?.payload_hash)]] },
    { key: 'receipt1', title: 'RECEIPT 1', status: r1 ? 'completed' : 'pending', accent: 'gold', summary: 'oracle proof + x402 info', ...rec(r1) },
    { key: 'risk', title: 'RISK GATE', status: risk ? (rejected ? 'rejected' : 'completed') : 'pending', accent: rejected ? 'red' : 'purple', summary: txt(risk?.payload?.summary || risk?.payload?.noTradeReason || 'analyzer / risk_gate / resolver_output'), fields: [['confidence', txt(risk?.payload?.confidence)], ['direction', txt(risk?.payload?.suggestedDirection)]] },
    { key: 'receipt2', title: 'RECEIPT 2', status: r2 ? 'completed' : 'pending', accent: 'gold', summary: 'risk gate proof', ...rec(r2) },
    { key: 'evaluator', title: 'EVALUATOR', status: evaluator ? (evalRejected ? 'rejected' : 'completed') : 'pending', accent: evalRejected ? 'red' : 'green', summary: txt(evalRejected ? 'Rejected' : evaluator?.payload?.approved === true ? 'Approved' : 'Evaluator pending'), fields: [['approved', txt(evaluator?.payload?.approved)], ['reason', txt(evaluator?.payload?.reason)]] },
    { key: 'receipt3', title: 'RECEIPT 3', status: r3 ? 'completed' : 'pending', accent: 'gold', summary: 'evaluator proof', ...rec(r3) },
    { key: 'executor', title: 'EXECUTOR', status: rejected ? 'rejected' : executor ? 'active' : 'pending', accent: rejected ? 'red' : 'neutral', summary: rejected ? 'DISCARD / NO ACTION' : txt(executor?.payload?.reason || 'execution intent'), fields: [['action', txt(executor?.payload?.action)], ['payload_hash', shortHash(executor?.payload_hash)]] },
  ];
}

export function PredictionMarketDecisionBoardV2({ session }: { session: BridgeSession | null }) {
  const nodes = useMemo(() => buildNodes(session), [session]);
  const hasPaymentAt = (idx: number) => Boolean(nodes[idx + 1]?.receiptType === 'x402_arc_native' && nodes[idx + 1]?.tx);

  return <section className="rounded-md border border-white/10 bg-[#050505] p-4">
    <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#C5A67C]">Decision Board</div>
    <div className="grid gap-3 lg:grid-cols-[1fr_20px_1fr_20px_1fr_20px_1fr_20px_1fr_20px_1fr_20px_1fr]">
      {nodes.map((n, i) => <div key={n.key} className="contents"><DecisionNodeCard node={n} onClick={() => undefined} />{i < nodes.length - 1 ? <FlowEdge active={n.status !== 'pending'} payment={hasPaymentAt(i)} /> : null}</div>)}
    </div>
  </section>;
}
