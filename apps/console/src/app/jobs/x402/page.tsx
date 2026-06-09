'use client';

import { FormEvent, ReactNode, useState } from 'react';
import { useX402PaidFetch } from '@/hooks/useX402PaidFetch';
import { X402ActionGate } from '@/components/x402/X402ActionGate';

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

  const [quoteJobDescription, setQuoteJobDescription] = useState('');
  const [quoteUrgency, setQuoteUrgency] = useState<'normal' | 'medium' | 'high'>('normal');
  const [quoteState, setQuoteState] = useState<ActionState>(INITIAL_ACTION_STATE);

  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createBudget, setCreateBudget] = useState('');
  const [createRequester, setCreateRequester] = useState('');
  const [createState, setCreateState] = useState<ActionState>(INITIAL_ACTION_STATE);

  const [routeJobId, setRouteJobId] = useState('');
  const [routeRole, setRouteRole] = useState('');
  const [routeCategory, setRouteCategory] = useState('');
  const [routeCapabilitiesCsv, setRouteCapabilitiesCsv] = useState('');
  const [routeState, setRouteState] = useState<ActionState>(INITIAL_ACTION_STATE);

  const [proofJobId, setProofJobId] = useState('');
  const [proofAgentId, setProofAgentId] = useState('');
  const [proofProofType, setProofProofType] = useState('');
  const [proofProofData, setProofProofData] = useState('');
  const [proofSummary, setProofSummary] = useState('');
  const [proofState, setProofState] = useState<ActionState>(INITIAL_ACTION_STATE);

  const [verifyJobId, setVerifyJobId] = useState('');
  const [verifyReceiptId, setVerifyReceiptId] = useState('');
  const [verifyVerifierAgent, setVerifyVerifierAgent] = useState('');
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
              void runPaidPost('/api/x402/jobs/quote', { jobDescription: quoteJobDescription, urgency: quoteUrgency }, setQuoteState);
            }}
          >
            <div>
              <label className={labelClass}>jobDescription</label>
              <input required value={quoteJobDescription} onChange={(e) => setQuoteJobDescription(e.target.value)} className={fieldClass} />
            </div>
            <div>
              <label className={labelClass}>urgency</label>
              <select value={quoteUrgency} onChange={(e) => setQuoteUrgency(e.target.value as 'normal' | 'medium' | 'high')} className={fieldClass}>
                <option value="normal">normal</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <X402ActionGate lockedMessage="Pay 0.1 USDC via x402 on the homepage to unlock actions">

              <button disabled={quoteState.loading} className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] disabled:opacity-50">{quoteState.loading ? 'Quoting…' : 'Quote job'}</button>

            </X402ActionGate>
          </form>
        </ActionPanel>

        <ActionPanel title="2) Create job" state={createState}>
          <form
            className="space-y-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void runPaidPost('/api/x402/jobs/create', { title: createTitle, description: createDescription, budget: createBudget, requester: createRequester }, setCreateState);
            }}
          >
            <div><label className={labelClass}>title</label><input required value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>description</label><input required value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>budget</label><input value={createBudget} onChange={(e) => setCreateBudget(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>requester</label><input value={createRequester} onChange={(e) => setCreateRequester(e.target.value)} className={fieldClass} /></div>
            <X402ActionGate lockedMessage="Pay 0.1 USDC via x402 on the homepage to unlock actions">

              <button disabled={createState.loading} className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] disabled:opacity-50">{createState.loading ? 'Creating…' : 'Create job'}</button>

            </X402ActionGate>
          </form>
        </ActionPanel>

        <ActionPanel title="3) Route job" state={routeState}>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            void runPaidPost(`/api/x402/jobs/${routeJobId}/route`, {
              role: routeRole,
              category: routeCategory,
              capabilities: routeCapabilitiesCsv.split(',').map((x) => x.trim()).filter(Boolean),
            }, setRouteState);
          }}>
            <div><label className={labelClass}>job id</label><input required value={routeJobId} onChange={(e) => setRouteJobId(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>role</label><input value={routeRole} onChange={(e) => setRouteRole(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>category</label><input value={routeCategory} onChange={(e) => setRouteCategory(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>capabilitiesCsv</label><input value={routeCapabilitiesCsv} onChange={(e) => setRouteCapabilitiesCsv(e.target.value)} className={fieldClass} /></div>
            <X402ActionGate lockedMessage="Pay 0.1 USDC via x402 on the homepage to unlock actions">

              <button disabled={routeState.loading} className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] disabled:opacity-50">{routeState.loading ? 'Routing…' : 'Route job'}</button>

            </X402ActionGate>
          </form>
        </ActionPanel>

        <ActionPanel title="4) Submit proof" state={proofState}>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            void runPaidPost(`/api/x402/jobs/${proofJobId}/submit-proof`, {
              agentId: proofAgentId,
              proofType: proofProofType,
              proofData: proofProofData,
              summary: proofSummary,
            }, setProofState);
          }}>
            <div><label className={labelClass}>job id</label><input required value={proofJobId} onChange={(e) => setProofJobId(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>agentId</label><input required value={proofAgentId} onChange={(e) => setProofAgentId(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>proofType</label><input value={proofProofType} onChange={(e) => setProofProofType(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>proofData</label><input required value={proofProofData} onChange={(e) => setProofProofData(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>summary</label><input value={proofSummary} onChange={(e) => setProofSummary(e.target.value)} className={fieldClass} /></div>
            <X402ActionGate lockedMessage="Pay 0.1 USDC via x402 on the homepage to unlock actions">

              <button disabled={proofState.loading} className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] disabled:opacity-50">{proofState.loading ? 'Submitting…' : 'Submit proof'}</button>

            </X402ActionGate>
          </form>
        </ActionPanel>

        <ActionPanel title="5) Verify proof" state={verifyState}>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            void runPaidPost(`/api/x402/jobs/${verifyJobId}/verify`, { receiptId: verifyReceiptId, verifierAgent: verifyVerifierAgent }, setVerifyState);
          }}>
            <div><label className={labelClass}>job id</label><input required value={verifyJobId} onChange={(e) => setVerifyJobId(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>receiptId</label><input required value={verifyReceiptId} onChange={(e) => setVerifyReceiptId(e.target.value)} className={fieldClass} /></div>
            <div><label className={labelClass}>verifierAgent</label><input value={verifyVerifierAgent} onChange={(e) => setVerifyVerifierAgent(e.target.value)} className={fieldClass} /></div>
            <X402ActionGate lockedMessage="Pay 0.1 USDC via x402 on the homepage to unlock actions">

              <button disabled={verifyState.loading} className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] disabled:opacity-50">{verifyState.loading ? 'Verifying…' : 'Verify proof'}</button>

            </X402ActionGate>
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
