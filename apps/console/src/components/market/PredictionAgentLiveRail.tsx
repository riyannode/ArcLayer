'use client';

type AgentLiveEvent = {
  eventType: string;
  title?: string | null;
  summary?: string | null;
  decision?: string | null;
  confidence?: number | null;
  trace?: string[];
  createdAt?: string;
  txHash?: string | null;
  amountAtomic?: string | null;
  currency?: string | null;
  metadata?: Record<string, unknown> | null;
};

const STEPS = [
  'tick_feed',
  'scan',
  'misprice_detect',
  'fair_prob_model',
  'arb_check',
  'x402_paid',
  'llm_reasoned',
  'run_job',
  'submit_proof',
];

function label(step: string) {
  return step.replaceAll('_', ' ');
}

function confidenceLabel(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

function shortHash(txHash?: string | null) {
  if (!txHash) return null;
  if (txHash.length <= 14) return txHash;
  return `${txHash.slice(0, 8)}...${txHash.slice(-6)}`;
}

function getEventStatus(latestEvent?: AgentLiveEvent | null): 'success' | 'rejected' | 'failed' | 'pending' {
  if (!latestEvent) return 'pending';
  const metadataStatus = typeof latestEvent.metadata?.status === 'string' ? latestEvent.metadata.status.toLowerCase() : null;
  if (metadataStatus === 'rejected') return 'rejected';
  if (metadataStatus === 'failed') return 'failed';

  const eventType = String(latestEvent.eventType || '').toLowerCase();
  if (eventType.includes('reject')) return 'rejected';
  if (eventType.includes('failed') || eventType.includes('error')) return 'failed';

  const decision = String(latestEvent.decision || '').toLowerCase();
  if (['reject', 'rejected', 'skip', 'denied'].includes(decision)) return 'rejected';

  return 'success';
}

function getReasoning(latestEvent?: AgentLiveEvent | null) {
  if (!latestEvent) return null;
  const metadata = latestEvent.metadata || {};
  const reasoning = metadata.reasoning || metadata.llmReasoning || metadata.reason || latestEvent.summary;
  return typeof reasoning === 'string' ? reasoning : null;
}

export function PredictionAgentLiveRail({ latestEvent }: { latestEvent?: AgentLiveEvent | null }) {
  const trace = new Set(latestEvent?.trace ?? []);
  if (latestEvent?.eventType) trace.add(latestEvent.eventType);
  const status = getEventStatus(latestEvent);
  const reasoning = getReasoning(latestEvent);

  return (
    <div className="mb-3 rounded border border-[#C5A67C]/15 bg-black/30 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#C5A67C]">Live Decision Rail</div>
        <div className="flex items-center gap-2">
          <div
            className={[
              'rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]',
              status === 'success' ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-200' : '',
              status === 'rejected' || status === 'failed' ? 'border-red-300/60 bg-red-400/10 text-red-200' : '',
              status === 'pending' ? 'border-amber-300/50 bg-amber-300/10 text-amber-200' : '',
            ].join(' ')}
          >
            {status}
          </div>
          <div className="truncate font-mono text-[10px] text-[#EAE4D8]/55">
            {latestEvent?.summary || latestEvent?.title || 'waiting for live agent event'}
            {latestEvent?.decision ? ` · ${latestEvent.decision}` : ''}
            {confidenceLabel(latestEvent?.confidence) ? ` · ${confidenceLabel(latestEvent?.confidence)}` : ''}
            {latestEvent?.txHash ? ` · ${shortHash(latestEvent.txHash)}` : ''}
            {latestEvent?.amountAtomic || latestEvent?.currency
              ? ` · ${(latestEvent?.amountAtomic || '').toString()} ${latestEvent?.currency || ''}`.trim()
              : ''}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {STEPS.map((step, index) => {
          const active = trace.has(step);
          const decisionReject = ['reject', 'rejected', 'skip', 'denied'].includes(String(latestEvent?.decision || '').toLowerCase());
          const redByType =
            (latestEvent?.eventType === 'decision_rejected' && (step === 'fair_prob_model' || step === 'arb_check')) ||
            ((latestEvent?.eventType === 'x402_rejected' || latestEvent?.eventType === 'x402_failed') && step === 'x402_paid') ||
            (latestEvent?.eventType === 'proof_failed' && step === 'submit_proof') ||
            (decisionReject && (step === latestEvent?.eventType || step === 'run_job'));
          const pulse = latestEvent?.eventType === step;
          return (
            <div key={step} className="flex items-center gap-2">
              <div
                className={[
                  'rounded-full border px-3 py-1 font-mono text-[9px] uppercase tracking-[0.14em]',
                  active && !redByType
                    ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-200 shadow-[0_0_18px_rgba(52,211,153,0.25)]'
                    : '',
                  active && redByType
                    ? 'border-red-300/60 bg-red-400/10 text-red-200 shadow-[0_0_18px_rgba(248,113,113,0.25)]'
                    : '',
                  !active ? 'border-white/10 bg-white/[0.03] text-[#81796E]' : '',
                  pulse ? 'animate-pulse' : '',
                ].join(' ')}
              >
                {label(step)}
              </div>
              {index < STEPS.length - 1 ? <div className="h-px w-5 bg-[#C5A67C]/20" /> : null}
            </div>
          );
        })}
      </div>

      {reasoning ? (
        <div
          className={[
            'mt-3 rounded border p-2',
            status === 'rejected' || status === 'failed' ? 'border-red-300/40 bg-red-500/5' : 'border-emerald-300/30 bg-emerald-500/5',
          ].join(' ')}
        >
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[#C5A67C]">LLM Reasoning</div>
          <div className="text-xs text-[#EAE4D8]/80">{reasoning}</div>
        </div>
      ) : null}
    </div>
  );
}
