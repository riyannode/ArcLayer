'use client';

import type { DecisionNode } from './PredictionMarketDecisionBoardV2';
import { ARC_SCAN_TX } from './explorer';

const accentMap: Record<DecisionNode['accent'], string> = {
  blue: 'border-cyan-300/40 text-cyan-100',
  gold: 'border-amber-300/60 text-amber-100',
  purple: 'border-violet-300/45 text-violet-100',
  green: 'border-emerald-300/45 text-emerald-100',
  red: 'border-red-300/45 text-red-100',
  neutral: 'border-white/20 text-zinc-100',
};

export function DecisionNodeCard({ node, onClick }: { node: DecisionNode; onClick: () => void }) {
  const baseState = node.status === 'pending' ? 'opacity-60 grayscale-[0.2]' : node.status === 'active' ? 'animate-pulse shadow-[0_0_24px_rgba(16,185,129,0.35)]' : node.status === 'completed' ? 'bg-emerald-500/5' : 'bg-red-950/20';
  return (
    <button onClick={onClick} className={`min-h-[182px] rounded-md border bg-[#0A0A0A] p-3 text-left transition ${accentMap[node.accent]} ${baseState}`}>
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.15em]">{node.title}</div>
        <span className="rounded border border-current/40 px-1.5 py-0.5 text-[9px] uppercase">{node.status === 'completed' ? '✓' : node.status}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-zinc-200/90">{node.summary}</p>
      <div className="mt-3 space-y-1 text-[11px] text-zinc-300/80">
        {node.fields.map(([k, v]) => <div key={k} className="flex justify-between gap-2"><span>{k}</span><span className="max-w-[120px] truncate font-mono">{v}</span></div>)}
      </div>
      {node.receiptType ? <p className="mt-2 font-mono text-[10px] uppercase text-amber-200">{node.receiptType}</p> : null}
      {node.paymentReason && node.paymentReason !== '—' ? <p className="mt-1 text-[11px] text-amber-100/90">{node.paymentReason}</p> : null}
      {node.tx ? <a href={`${ARC_SCAN_TX}${node.tx}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded border border-amber-300/50 px-2 py-1 font-mono text-[10px] uppercase text-amber-100">View Tx</a> : null}
    </button>
  );
}

export function FlowEdge({ active, payment }: { active: boolean; payment?: boolean }) {
  return <div className={`hidden h-px self-center lg:block ${!active ? 'bg-white/10' : payment ? 'bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.9)] animate-pulse' : 'bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.8)]'}`} />;
}
