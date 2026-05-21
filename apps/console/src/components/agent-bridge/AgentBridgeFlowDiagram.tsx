import type { BridgeSession } from './types';

const STEPS = [
  ['External Runtime', 'Posts signed event'],
  ['Registered Agent', 'Work output'],
  ['Verification', 'Proof/hash check'],
  ['Receipt', 'Immutable audit trail'],
  ['x402 Access', 'Paid resource unlock'],
];

export function AgentBridgeFlowDiagram({ session }: { session: BridgeSession | null }) {
  const completed = session ? Math.min(STEPS.length, Math.max(1, session.events.length + (session.receipts.length ? 1 : 0))) : 0;
  return (
    <div className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Bridge Flow</div>
      <div className="grid gap-3 md:grid-cols-5">
        {STEPS.map(([title, subtitle], index) => {
          const active = index < completed;
          return (
            <div key={title} className={`relative rounded-sm border p-3 ${active ? 'border-[#C5A67C]/45 bg-[#C5A67C]/10' : 'border-white/10 bg-white/[0.03]'}`}>
              <div className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#F5F0E5]">{title}</div>
              <div className="mt-2 text-xs text-[#EAE4D8]/60">{subtitle}</div>
              <div className="mt-3 font-mono text-[10px] text-[#EAE4D8]/40">STEP {index + 1}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
