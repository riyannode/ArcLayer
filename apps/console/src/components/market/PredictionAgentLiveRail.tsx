'use client';

type AgentLiveEvent = {
  eventType: string;
  title?: string | null;
  summary?: string | null;
  decision?: string | null;
  confidence?: number | null;
  trace?: string[];
  createdAt?: string;
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

export function PredictionAgentLiveRail({ latestEvent }: { latestEvent?: AgentLiveEvent | null }) {
  const trace = new Set(latestEvent?.trace ?? []);
  if (latestEvent?.eventType) trace.add(latestEvent.eventType);

  return (
    <div className="mb-3 rounded border border-[#C5A67C]/15 bg-black/30 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#C5A67C]">Live Decision Rail</div>
        <div className="truncate font-mono text-[10px] text-[#EAE4D8]/55">
          {latestEvent?.summary || latestEvent?.title || 'waiting for live agent event'}
          {latestEvent?.decision ? ` · ${latestEvent.decision}` : ''}
          {confidenceLabel(latestEvent?.confidence) ? ` · ${confidenceLabel(latestEvent?.confidence)}` : ''}
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {STEPS.map((step, index) => {
          const active = trace.has(step);
          const pulse = latestEvent?.eventType === step || (step === 'x402_paid' && latestEvent?.eventType === 'x402_paid');
          return (
            <div key={step} className="flex items-center gap-2">
              <div
                className={[
                  'rounded-full border px-3 py-1 font-mono text-[9px] uppercase tracking-[0.14em]',
                  active
                    ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-200 shadow-[0_0_18px_rgba(52,211,153,0.25)]'
                    : 'border-white/10 bg-white/[0.03] text-[#81796E]',
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
    </div>
  );
}
