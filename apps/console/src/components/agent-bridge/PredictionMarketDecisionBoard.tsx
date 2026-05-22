'use client';

import { useMemo, useState } from 'react';
import type { BridgeEvent, BridgeReceipt, BridgeSession } from './types';
import { eventType, shortHash } from './types';

const ARC_SCAN_TX = 'https://testnet.arcscan.app/tx/';

type NodeState = 'pending' | 'active' | 'completed' | 'rejected' | 'stale';
type FlowKey = 'oracle' | 'receipt1' | 'risk' | 'receipt2' | 'evaluator' | 'receipt3' | 'executor' | 'discard';

export type DecisionNode = {
  key: FlowKey;
  title: string;
  role: string;
  status: NodeState;
  accent: 'cyan' | 'gold' | 'purple' | 'green' | 'red' | 'neutral';
  summary?: string;
  rationale?: string[];
  tx?: string | null;
  receiptType?: string | null;
  payloadHash?: string | null;
  event?: BridgeEvent | null;
  receipt?: BridgeReceipt | null;
  fields: Array<[string, string]>;
};

type Props = {
  session: BridgeSession | null;
  marketData?: Record<string, unknown> | null;
  orderbookData?: Record<string, unknown> | null;
  candleData?: Record<string, unknown> | null;
  onSelectNode?: (node: DecisionNode) => void;
};

function asText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.slice(0, 3).map(asText).join(', ') || '—';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 90);
  return String(value);
}

function numPct(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return n <= 1 ? `${(n * 100).toFixed(1)}%` : n.toFixed(2);
}

function latest(events: BridgeEvent[], pred: (event: BridgeEvent) => boolean) {
  return events.filter(pred).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
}

function receiptMatches(receipt: BridgeReceipt, event: BridgeEvent | null, roles: string[], types: string[]) {
  if (event?.payload_hash && receipt.payload_hash === event.payload_hash) return true;
  const meta = receipt.metadata ?? {};
  const role = asText(meta.role).toLowerCase();
  const type = asText(meta.event_type || meta.type).toLowerCase();
  return roles.includes(role) || types.includes(type);
}

function matchReceipt(receipts: BridgeReceipt[], event: BridgeEvent | null, roles: string[], types: string[]) {
  const sorted = [...receipts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const exact = sorted.find((receipt) => receiptMatches(receipt, event, roles, types));
  if (exact) return exact;
  if (!event) return null;
  const after = sorted
    .filter((receipt) => Date.parse(receipt.created_at) >= Date.parse(event.created_at))
    .sort((a, b) => Math.abs(Date.parse(a.created_at) - Date.parse(event.created_at)) - Math.abs(Date.parse(b.created_at) - Date.parse(event.created_at)))[0];
  return after ?? null;
}

function isStale(event?: BridgeEvent | null) {
  if (!event?.created_at) return false;
  return Date.now() - Date.parse(event.created_at) > 20 * 60_000;
}

function eventStatus(event: BridgeEvent | null, latestEvent: BridgeEvent | null, rejected = false): NodeState {
  if (rejected) return 'rejected';
  if (!event) return 'pending';
  if (isStale(event)) return 'stale';
  return latestEvent && event.id === latestEvent.id ? 'active' : 'completed';
}

function receiptStatus(receipt: BridgeReceipt | null): NodeState {
  if (!receipt) return 'pending';
  return Date.now() - Date.parse(receipt.created_at) > 20 * 60_000 ? 'stale' : 'completed';
}

export function buildPredictionMarketDecisionNodes(session: BridgeSession | null, marketData?: Record<string, unknown> | null): DecisionNode[] {
  const events = session?.events ?? [];
  const receipts = session?.receipts ?? [];
  const oracle = latest(events, (event) => event.role === 'oracle' || eventType(event) === 'market_snapshot');
  const risk = latest(events, (event) => ['analyzer', 'risk_gate'].includes(event.role) || ['resolver_output', 'risk_output'].includes(eventType(event)));
  const evaluator = latest(events, (event) => event.role === 'evaluator' || eventType(event) === 'evaluation');
  const executor = latest(events, (event) => event.role === 'executor' || eventType(event) === 'execution_intent');
  const receipt1 = matchReceipt(receipts, oracle, ['oracle'], ['market_snapshot']);
  const receipt2 = matchReceipt(receipts, risk, ['analyzer', 'risk_gate'], ['resolver_output', 'risk_output']);
  const receipt3 = matchReceipt(receipts, evaluator, ['evaluator'], ['evaluation']);
  const riskPayload = risk?.payload ?? {};
  const evalPayload = evaluator?.payload ?? {};
  const execPayload = executor?.payload ?? {};
  const evaluatorRejected = evaluator ? evalPayload.approved === false : false;
  const riskRejected = Boolean(riskPayload.noTradeReason);
  const rejected = riskRejected || evaluatorRejected;
  const latestEvent = [oracle, risk, evaluator, executor]
    .filter((event): event is BridgeEvent => Boolean(event))
    .filter((event) => !isStale(event))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;

  const receiptNode = (key: FlowKey, title: string, proof: string, typeLabel: string, receipt: BridgeReceipt | null): DecisionNode => ({
    key,
    title,
    role: proof,
    status: receiptStatus(receipt),
    accent: 'gold',
    summary: receipt ? `${proof} receipt` : 'No onchain settlement yet',
    tx: receipt?.transaction,
    receiptType: receipt?.receipt_type,
    payloadHash: receipt?.payload_hash,
    receipt,
    fields: [
      ['proof', proof],
      ['event', typeLabel],
      ['receipt', receipt?.receipt_type ?? 'pending'],
      ['payment', receipt?.payment_id ?? receipt?.payment_ref ?? '—'],
      ['hash', shortHash(receipt?.payload_hash)],
      ['created', receipt?.created_at ? new Date(receipt.created_at).toLocaleTimeString() : '—'],
    ],
  });

  return [
    {
      key: 'oracle', title: 'ORACLE', role: 'oracle', status: eventStatus(oracle, latestEvent), accent: 'cyan', event: oracle,
      payloadHash: oracle?.payload_hash ?? asText(marketData?.payloadHash),
      summary: asText(oracle?.payload?.llmSummary && typeof oracle.payload.llmSummary === 'object' ? (oracle.payload.llmSummary as Record<string, unknown>).summary : oracle?.payload?.summary),
      fields: [['source', 'raw market data'], ['market', asText(marketData?.marketSlug || oracle?.payload?.marketSlug)], ['UP', numPct(marketData?.upPrice || oracle?.payload?.upPrice)], ['DOWN', numPct(marketData?.downPrice || oracle?.payload?.downPrice)], ['last', oracle?.created_at ? new Date(oracle.created_at).toLocaleTimeString() : '—'], ['hash', shortHash(oracle?.payload_hash ?? asText(marketData?.payloadHash))]],
    },
    receiptNode('receipt1', 'RECEIPT 1', 'oracle proof', 'market_snapshot', receipt1),
    {
      key: 'risk', title: 'RISK GATE', role: risk?.role ?? 'analyzer', status: eventStatus(risk, latestEvent, riskRejected), accent: riskRejected ? 'red' : 'purple', event: risk,
      payloadHash: risk?.payload_hash,
      summary: asText(riskPayload.summary || riskPayload.noTradeReason || 'LLM/analyzer risk'),
      rationale: Array.isArray(riskPayload.rationale) ? riskPayload.rationale.map(asText).slice(0, 3) : [],
      fields: [['confidence', numPct(riskPayload.confidence)], ['direction', asText(riskPayload.suggestedDirection)], ['entry', asText(riskPayload.entryMode || riskPayload.regime)], ['noTrade', asText(riskPayload.noTradeReason)], ['model', asText(riskPayload.llmModel)], ['fallback', riskPayload.usedFallback ? 'yes' : 'no']],
    },
    receiptNode('receipt2', 'RECEIPT 2', 'risk gate proof', 'resolver_output / risk_output', receipt2),
    {
      key: 'evaluator', title: 'EVALUATOR', role: 'evaluator', status: eventStatus(evaluator, latestEvent, evaluatorRejected), accent: evaluatorRejected ? 'red' : 'green', event: evaluator,
      payloadHash: evaluator?.payload_hash,
      summary: evaluator ? (evalPayload.approved === false ? 'Rejected' : evalPayload.approved === true ? 'Approved' : 'Evaluation') : 'Evaluator pending',
      rationale: [evalPayload.reason, evalPayload.checks, evalPayload.flags].flat().map(asText).filter((x) => x !== '—').slice(0, 3),
      fields: [['decision', evaluator ? (evalPayload.approved === false ? 'reject' : evalPayload.approved === true ? 'approve' : 'pending') : 'pending'], ['risk', asText(evalPayload.riskLevel)], ['checks', asText(evalPayload.checks)], ['flags', asText(evalPayload.flags)], ['model', asText(evalPayload.llmModel)], ['fallback', evalPayload.usedFallback ? 'yes' : 'no']],
    },
    receiptNode('receipt3', 'RECEIPT 3', 'evaluator proof', 'evaluation output', receipt3),
    {
      key: 'executor', title: 'EXECUTOR', role: 'executor', status: rejected ? 'pending' : eventStatus(executor, latestEvent), accent: 'neutral', event: executor,
      payloadHash: executor?.payload_hash,
      summary: asText(execPayload.reason || 'Final intent · DRY_RUN'),
      fields: [['DRY_RUN', 'true'], ['action', asText(execPayload.action)], ['mockTrade', asText(execPayload.mockTrade)], ['safety', asText(execPayload.safety)], ['model', asText(execPayload.llmModel)], ['fallback', execPayload.usedFallback ? 'yes' : 'no']],
    },
    {
      key: 'discard', title: 'DISCARD / NO ACTION', role: 'safety branch', status: rejected ? 'rejected' : 'pending', accent: 'red',
      summary: asText(riskPayload.noTradeReason || evalPayload.reason || 'No rejection active'),
      rationale: [riskPayload.noTradeReason, evalPayload.flags].flat().map(asText).filter((x) => x !== '—').slice(0, 3),
      fields: [['risk block', asText(riskPayload.noTradeReason)], ['evaluator', evaluatorRejected ? 'rejected' : 'pending'], ['flags', asText(evalPayload.flags)]],
    },
  ];
}

function NodeCard({ node, selected, onClick }: { node: DecisionNode; selected: boolean; onClick: () => void }) {
  const accent = {
    cyan: 'border-cyan-300/35 text-cyan-200 shadow-cyan-400/10', gold: 'border-[#C5A67C]/55 text-[#F5D58A] shadow-[#C5A67C]/15', purple: 'border-purple-300/35 text-purple-200 shadow-purple-400/10', green: 'border-emerald-300/35 text-emerald-200 shadow-emerald-400/10', red: 'border-red-300/40 text-red-200 shadow-red-400/10', neutral: 'border-white/20 text-[#EAE4D8] shadow-white/5',
  }[node.accent];
  const stateClass = node.status === 'active' ? 'animate-pulse shadow-lg' : node.status === 'completed' ? 'bg-emerald-400/[0.04]' : node.status === 'rejected' ? 'bg-red-950/25' : node.status === 'stale' ? 'opacity-70' : 'opacity-55';
  return (
    <button onClick={onClick} className={`min-h-[210px] rounded-sm border bg-[#080808]/95 p-3 text-left transition hover:bg-white/[0.04] ${accent} ${stateClass} ${selected ? 'ring-1 ring-[#C5A67C]/70' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em]">{node.title}</div>
        <span className="rounded-sm border border-current/30 px-1.5 py-0.5 font-mono text-[9px] uppercase">{node.status === 'completed' ? '✓ done' : node.status}</span>
      </div>
      <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[#EAE4D8]/45">{node.role}</div>
      <p className="mt-3 line-clamp-3 text-xs leading-5 text-[#EAE4D8]/70">{node.summary || 'pending data'}</p>
      <div className="mt-3 grid gap-1.5 text-[11px] text-[#EAE4D8]/55">
        {node.fields.slice(0, 5).map(([label, value]) => <div key={label} className="flex justify-between gap-2"><span>{label}</span><span className="max-w-[150px] truncate font-mono text-[#C5A67C]">{value}</span></div>)}
      </div>
      {node.tx ? <a href={`${ARC_SCAN_TX}${node.tx}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-sm border border-[#C5A67C]/40 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[#C5A67C]">View Tx</a> : null}
    </button>
  );
}

function Edge({ active, reject = false }: { active: boolean; reject?: boolean }) {
  return <div className={`hidden h-px self-center lg:block ${active ? (reject ? 'bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.7)]' : 'bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.7)]') : 'bg-white/10'}`} />;
}

export function PredictionMarketDecisionBoard({ session, marketData, onSelectNode }: Props) {
  const nodes = useMemo(() => buildPredictionMarketDecisionNodes(session, marketData), [session, marketData]);
  const [selectedKey, setSelectedKey] = useState<FlowKey>('risk');
  const selected = nodes.find((node) => node.key === selectedKey) ?? nodes[0];
  const main = nodes.filter((node) => node.key !== 'discard');
  const discard = nodes.find((node) => node.key === 'discard');

  function select(node: DecisionNode) {
    setSelectedKey(node.key);
    onSelectNode?.(node);
  }

  const rejected = discard?.status === 'rejected';
  const lastFlowIndex = main.reduce((last, node, index) => (['completed', 'active', 'rejected'].includes(node.status) ? index : last), -1);

  return (
    <section className="rounded-sm border border-white/10 bg-[#050505] p-4 shadow-2xl shadow-black/30">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Live Strategy Sequence</div>
          <h2 className="mt-1 text-xl font-black uppercase tracking-[0.14em] text-[#F5F0E5]">ORACLE → RECEIPT 1 → RISK GATE → RECEIPT 2 → EVALUATOR → RECEIPT 3 → EXECUTOR</h2>
        </div>
        <span className="rounded-sm border border-[#C5A67C]/30 px-2 py-1 font-mono text-[10px] uppercase text-[#C5A67C]">3 receipt cycle</span>
      </div>

      {rejected && discard ? (
        <div className="mb-4 grid gap-3 lg:grid-cols-7">
          <div className="hidden lg:block lg:col-span-2" />
          <div className="lg:col-span-2"><NodeCard node={discard} selected={selected.key === 'discard'} onClick={() => select(discard)} /></div>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr_24px_1fr_24px_1fr_24px_1fr]">
        {main.map((node, index) => (
          <div key={node.key} className="contents">
            <NodeCard node={node} selected={selected.key === node.key} onClick={() => select(node)} />
            {index < main.length - 1 ? <Edge active={index < lastFlowIndex} reject={rejected && index >= lastFlowIndex} /> : null}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-sm border border-white/10 bg-white/[0.03] p-3 text-xs text-[#EAE4D8]/60">
        Final status: <span className="font-mono text-[#C5A67C]">{rejected ? 'NO ACTION / DISCARD' : selected.status}</span> · x402: <span className="font-mono text-[#C5A67C]">{main.some((node) => node.receiptType === 'x402_arc_native' && node.tx) ? 'settled receipt visible' : 'No onchain settlement yet'}</span>
      </div>
    </section>
  );
}
