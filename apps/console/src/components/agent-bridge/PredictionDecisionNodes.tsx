'use client';

import type { DecisionNode } from './PredictionMarketDecisionBoardV2';

const ARC_SCAN_TX = 'https://testnet.arcscan.app/tx/';

const accentMap: Record<DecisionNode['accent'], string> = {
  blue: 'border-cyan-300/40 text-cyan-100',
  gold: 'border-amber-300/60 text-amber-100',
  purple: 'border-violet-300/45 text-violet-100',
  green: 'border-emerald-300/45 text-emerald-100',
  red: 'border-red-300/45 text-red-100',
  neutral: 'border-white/20 text-zinc-100',
};

export function DecisionNodeCard({ node, selected, onClick }: { node: DecisionNode; selected: boolean; onClick: () => void }) {
  const baseState =
    node.status === 'pending' ? 'opacity-60 grayscale-[0.15]' :
    node.status === 'active' ? 'animate-pulse shadow-[0_0_28px_rgba(245,158,11,0.35)]' :
    node.status === 'completed' ? 'bg-emerald-500/5' :
    'bg-red-950/25';

  return (
    <button onClick={onClick} className={`min-h-[210px] rounded-md border bg-[#0A0A0A] p-3 text-left transition hover:bg-white/[0.04] ${accentMap[node.accent]} ${baseState} ${selected ? 'ring-1 ring-amber-300/70' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.16em]">{node.title}</div>
        <span className="rounded border border-current/40 px-1.5 py-0.5 text-[9px] uppercase">{node.status === 'completed' ? '✓ completed' : node.status}</span>
      </div>
      <p className="mt-2 text-xs text-zinc-300/90">{node.summary}</p>
      <div className="mt-3 grid gap-1 text-[11px] text-zinc-300/75">
        {node.fields.slice(0, 5).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><span>{k}</span><span className="max-w-[120px] truncate font-mono">{v}</span></div>)}
      </div>
      {node.receiptType ? <p className="mt-2 font-mono text-[10px] uppercase text-amber-200/90">{node.receiptType}</p> : null}
      {node.paymentReason ? <p className="mt-1 text-[11px] text-amber-100/85">{node.paymentReason}</p> : null}
      {node.tx ? <a href={`${ARC_SCAN_TX}${node.tx}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded border border-amber-300/50 px-2 py-1 font-mono text-[10px] uppercase text-amber-100">View Tx</a> : null}
    </button>
  );
}

export function FlowEdge({ active, payment }: { active: boolean; payment?: boolean }) {
  return <div className={`hidden h-px self-center lg:block ${!active ? 'bg-white/10' : payment ? 'bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.9)] animate-pulse' : 'bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.8)]'}`} />;
}
