'use client';

import { FormEvent, ReactNode, useState } from 'react';
import { useX402PaidFetch } from '@/hooks/useX402PaidFetch';

type ActionState = {
  loading: boolean;
  error: string | null;
  txHash: string | null;
  response: unknown;
};

const INITIAL_ACTION_STATE: ActionState = {
  loading: false,
  error: null,
  txHash: null,
  response: null,
};

export default function X402JobsWorkbenchPage() {
  const { paidFetch } = useX402PaidFetch();

  const [quoteDescription, setQuoteDescription] = useState('');
  const [quoteState, setQuoteState] = useState<ActionState>(INITIAL_ACTION_STATE);

  const [createProvider, setCreateProvider] = useState('');
  const [createEvaluator, setCreateEvaluator] = useState('');
  const [createExpiredAt, setCreateExpiredAt] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createHook, setCreateHook] = useState('0x');
  const [createState, setCreateState] = useState<ActionState>(INITIAL_ACTION_STATE);

  const [routeJobId, setRouteJobId] = useState('');
  const [routeProvider, setRouteProvider] = useState('');
  const [routeState, setRouteState] = useState<ActionState>(INITIAL_ACTION_STATE);

  const [proofJobId, setProofJobId] = useState('');
  const [deliverableHash, setDeliverableHash] = useState('');
  const [proofState, setProofState] = useState<ActionState>(INITIAL_ACTION_STATE);

  const [verifyJobId, setVerifyJobId] = useState('');
  const [reasonHash, setReasonHash] = useState('');
  const [verifyState, setVerifyState] = useState<ActionState>(INITIAL_ACTION_STATE);

  async function runPaidPost(path: string, body: unknown, setState: (next: ActionState) => void) {
    setState({ loading: true, error: null, txHash: null, response: null });

    const result = await paidFetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    setState({
      loading: false,
      error: result.error ?? null,
      txHash: result.paymentTxHash ?? null,
      response: result.json,
    });
  }

  const fieldClass = 'w-full rounded-sm border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-[#EAE4D8] outline-none focus:border-[#C5A67C]';
  const labelClass = 'font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]';

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 text-[#EAE4D8] sm:px-6 lg:px-8">
      <header className="mb-8 space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">x402 jobs workbench</p>
        <h1 className="text-2xl font-black uppercase tracking-[0.14em] text-[#F5F0E5]">Execute paid jobs routes</h1>
        <p className="text-sm text-[#EAE4D8]/70">Every action sends a paid POST request through Arc x402 using your connected EOA wallet.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <ActionPanel title="1) Quote job" state={quoteState}>
          <form
            className="space-y-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void runPaidPost('/api/x402/jobs/quote', { description: quoteDescription }, setQuoteState);
            }}
          >
            <div>
              <label className={labelClass}>description</label>
              <input required value={quoteDescription} onChange={(e) => setQuoteDescription(e.target.value)} className={fieldClass} />
            </div>
            <button disabled={quoteState.loading} className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] disabled:opacity-50">{quoteState.loading ? 'Quoting…' : 'Quote job'}</button>
          </form>
        </ActionPanel>

        <ActionPanel title="2) Create job" state={createState}>
          <form
            className="space-y-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void runPaidPost('/api/x402/jobs/create', { provider: createProvider, evaluator: createEvaluator, expiredAt: createExpiredAt, description: createDescription, hook: createHook }, setCreateState);
            }}
          >
            {[
              ['provider', createProvider, setCreateProvider],
              ['evaluator', createEvaluator, setCreateEvaluator],
              ['expiredAt', createExpiredAt, setCreateExpiredAt],
              ['description', createDescription, setCreateDescription],
              ['hook', createHook, setCreateHook],
            ].map(([label, value, setter]) => (
              <div key={label as string}>
                <label className={labelClass}>{label as string}</label>
                <input required value={value as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)} className={fieldClass} />
              </div>
            ))}
            <button disabled={createState.loading} className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] disabled:opacity-50">{createState.loading ? 'Creating…' : 'Create job'}</button>
          </form>
        </ActionPanel>

        <ActionPanel title="3) Route job" state={routeState}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void runPaidPost(`/api/x402/jobs/${routeJobId}/route`, { provider: routeProvider }, setRouteState); }}>
            <div><label className={labelClass}>job id</label><input required value={routeJobId} onChange={(e) => setRouteJobId(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>provider</label><input required value={routeProvider} onChange={(e) => setRouteProvider(e.target.value)} className={fieldClass} /></div>
            <button disabled={routeState.loading} className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] disabled:opacity-50">{routeState.loading ? 'Routing…' : 'Route job'}</button>
          </form>
        </ActionPanel>

        <ActionPanel title="4) Submit proof" state={proofState}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void runPaidPost(`/api/x402/jobs/${proofJobId}/submit-proof`, { deliverableHash }, setProofState); }}>
            <div><label className={labelClass}>job id</label><input required value={proofJobId} onChange={(e) => setProofJobId(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>deliverableHash</label><input required value={deliverableHash} onChange={(e) => setDeliverableHash(e.target.value)} className={fieldClass} /></div>
            <button disabled={proofState.loading} className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] disabled:opacity-50">{proofState.loading ? 'Submitting…' : 'Submit proof'}</button>
          </form>
        </ActionPanel>

        <ActionPanel title="5) Verify proof" state={verifyState}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void runPaidPost(`/api/x402/jobs/${verifyJobId}/verify`, { reasonHash }, setVerifyState); }}>
            <div><label className={labelClass}>job id</label><input required value={verifyJobId} onChange={(e) => setVerifyJobId(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>reasonHash</label><input required value={reasonHash} onChange={(e) => setReasonHash(e.target.value)} className={fieldClass} /></div>
            <button disabled={verifyState.loading} className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] disabled:opacity-50">{verifyState.loading ? 'Verifying…' : 'Verify proof'}</button>
          </form>
        </ActionPanel>
      </section>
    </main>
  );
}

function ActionPanel({ title, state, children }: { title: string; state: ActionState; children: ReactNode }) {
  return (
    <article className="rounded-sm border border-white/10 bg-black/25 p-4">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.22em] text-[#C5A67C]">{title}</h2>
      {children}
      {state.error && <p className="mt-3 rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{state.error}</p>}
      {state.txHash && <p className="mt-3 text-xs text-[#B8CD7E]">Payment tx hash: <span className="font-mono break-all">{state.txHash}</span></p>}
      {state.response !== null && <pre className="mt-3 max-h-64 overflow-auto rounded-sm border border-white/10 bg-black/50 p-3 text-xs text-[#EAE4D8]/90">{JSON.stringify(state.response, null, 2)}</pre>}
    </article>
  );
}
