'use client';
import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
type Props = { clientName: string; params: Record<string,string>; scopes: string[] };
export function OAuthConsentClient({ clientName, params, scopes }: Props) {
  const { address, isConnected } = useAccount(); const { signMessageAsync } = useSignMessage(); const [ready, setReady] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  async function establishSession() { if (!address) return; setLoading(true); setError(''); try { const { ensureWalletSession } = await import('@/lib/auth/ensureWalletSession'); const result = await ensureWalletSession(address, signMessageAsync); if (!result.ok) setError(result.error || 'Wallet session required.'); else setReady(true); } catch { setError('Wallet signing was cancelled or failed.'); } finally { setLoading(false); } }
  return <main className="mx-auto min-h-screen max-w-2xl px-6 py-20 text-[#F4EFE5]">
    <div className="rounded-2xl border border-white/10 bg-black/30 p-8">
      <div className="font-mono text-xs uppercase tracking-[0.18em] text-[#F3C536]">ArcLayer OAuth</div>
      <h1 className="mt-3 text-3xl font-semibold">Authorize {clientName}</h1>
      <p className="mt-4 text-sm leading-6 text-[#EAE4D8]/65">OAuth lets this client call ArcLayer MCP tools. It does not grant private key access. Wallet approval is still required for every onchain transaction.</p>
      <div className="mt-6 rounded-lg border border-white/10 p-4"><div className="text-xs text-[#EAE4D8]/45">Requested scopes</div><ul className="mt-2 space-y-1 font-mono text-sm">{scopes.map((scope) => <li key={scope}>{scope}</li>)}</ul></div>
      <div className="mt-5 text-sm">Owner wallet: <span className="font-mono">{address ?? 'Connect wallet to continue'}</span></div>
      {!ready && <button disabled={!isConnected || loading} onClick={establishSession} className="mt-6 rounded-md bg-[#F3C536] px-5 py-3 text-sm font-semibold text-black disabled:opacity-40">{loading ? 'Signing…' : 'Connect and sign wallet'}</button>}
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      {ready && <div className="mt-6 flex gap-3">
        <form action="/oauth/authorize/approve" method="post">{Object.entries(params).map(([k,v]) => <input key={k} type="hidden" name={k} value={v} />)}<input type="hidden" name="decision" value="approve"/><button className="rounded-md bg-[#F3C536] px-5 py-3 text-sm font-semibold text-black">Approve</button></form>
        <form action="/oauth/authorize/approve" method="post">{Object.entries(params).map(([k,v]) => <input key={k} type="hidden" name={k} value={v} />)}<input type="hidden" name="decision" value="deny"/><button className="rounded-md border border-white/15 px-5 py-3 text-sm">Deny</button></form>
      </div>}
    </div>
  </main>;
}
