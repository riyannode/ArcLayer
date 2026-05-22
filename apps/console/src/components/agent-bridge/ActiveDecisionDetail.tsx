'use client';

import type { DecisionNode } from './PredictionMarketDecisionBoard';
import { shortHash } from './types';

const ARC_SCAN_TX = 'https://testnet.arcscan.app/tx/';

export function ActiveDecisionDetail({ node }: { node: DecisionNode | null }) {
  if (!node) {
    return <section className="rounded-sm border border-white/10 bg-black/25 p-4 text-sm text-[#EAE4D8]/55">Select node for detail.</section>;
  }
  return (
    <section className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Active Decision Detail</div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
          <h3 className="font-mono text-lg font-bold uppercase tracking-[0.14em] text-[#F5F0E5]">{node.title}</h3>
          <div className="mt-3 grid gap-2 text-xs text-[#EAE4D8]/60">
            <div>role: <span className="font-mono text-[#C5A67C]">{node.role}</span></div>
            <div>status: <span className="font-mono text-[#C5A67C]">{node.status}</span></div>
            <div>receipt: <span className="font-mono text-[#C5A67C]">{node.receiptType || '—'}</span></div>
            <div>payload hash: <span className="font-mono text-[#C5A67C]">{shortHash(node.payloadHash)}</span></div>
            <div>x402 state: <span className="font-mono text-[#C5A67C]">{node.receiptType === 'x402_arc_native' && node.tx ? 'settled' : 'No onchain settlement yet'}</span></div>
          </div>
          {node.tx ? <a href={`${ARC_SCAN_TX}${node.tx}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C]">View Tx</a> : null}
        </div>
        <div className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/45">Reasoning</div>
          <p className="mt-2 text-sm leading-6 text-[#EAE4D8]/70">{node.summary || 'No reasoning yet.'}</p>
          {node.rationale?.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-[#EAE4D8]/60">
              {node.rationale.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
          <div className="mt-4 grid gap-1.5 text-xs text-[#EAE4D8]/55 sm:grid-cols-2">
            {node.fields.map(([label, value]) => <div key={label}>{label}: <span className="font-mono text-[#C5A67C]">{value}</span></div>)}
          </div>
        </div>
      </div>
    </section>
  );
}
