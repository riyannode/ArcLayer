'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSignMessage } from 'wagmi';
import { useArcWallet } from '@/hooks/useArcWallet';
import { buildDerivJobKeyMessage } from '@/lib/a2a/deriv-job-key-message';

// ─── Types ───────────────────────────────────────────────────────────────────

type Policy = {
  role: string;
  label: string;
  description: string;
  scopes: string[];
  productionSafe: boolean;
};

type KeyEntry = {
  id: string;
  keyPrefix: string;
  label: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

type StatusResponse = {
  ok: true;
  agent: { agentId: string; name: string | null; status: string };
  keys: KeyEntry[];
  policy: { role: string; label: string; scopes: string[] };
};

type KeyActionResponse =
  | {
      ok: true;
      mode: 'replacement' | 'rotated';
      warning: string;
      hint?: string;
      key: string;
      env: string;
      keyMeta: {
        id: string;
        agentId: string;
        keyPrefix: string;
        scopes: string[];
        role: string;
        createdAt: string;
      };
    }
  | { ok: false; error: string; [k: string]: unknown };

type RevokeResponse = { ok: true; keyId: string; revoked: boolean } | { ok: false; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requestId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DerivJobKeysPage() {
  const wallet = useArcWallet();
  const { signMessageAsync, isPending } = useSignMessage();

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [agentId, setAgentId] = useState('');
  const [role, setRole] = useState('deriv-worker');
  const [jobType, setJobType] = useState('deriv_signal_analysis');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Status panel
  const [status, setStatus] = useState<StatusResponse | null>(null);

  // Result panel (create/rotate)
  const [result, setResult] = useState<KeyActionResponse | null>(null);

  // Revoke feedback
  const [revokedKeyId, setRevokedKeyId] = useState<string | null>(null);

  // Load policies on mount
  useEffect(() => {
    fetch('/api/a2a/deriv-job-keys/policies')
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setPolicies(data.roles);
      })
      .catch(() => {});
  }, []);

  const canSubmit = useMemo(
    () => wallet.isConnected && wallet.address && agentId.trim().length > 0 && !loading && !isPending,
    [wallet.isConnected, wallet.address, agentId, loading, isPending],
  );

  // ── Check status ───────────────────────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    if (!wallet.isConnected || !wallet.address) return;
    setResult(null);
    setRevokedKeyId(null);

    const id = requestId();
    const ts = Date.now();
    const msg = buildDerivJobKeyMessage({
      action: 'create_deriv_a2a_job_key',
      agentId: agentId.trim(),
      ownerAddress: wallet.address,
      role,
      jobType,
      timestamp: ts,
      requestId: id,
    });

    let signature: string;
    try {
      signature = await signMessageAsync({ message: msg });
    } catch {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/a2a/deriv-job-agents/${encodeURIComponent(agentId.trim())}/keys/status`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            ownerAddress: wallet.address,
            signature,
            timestamp: ts,
            role,
            requestId: id,
          }),
        },
      );
      const data = await res.json();
      if (data.ok) setStatus(data as StatusResponse);
      else setResult(data as KeyActionResponse);
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'status_failed' });
    } finally {
      setLoading(false);
    }
  }, [wallet, agentId, role, jobType, signMessageAsync]);

  // ── Create replacement (old keys stay active) ──────────────────────────────

  const createReplacement = useCallback(async () => {
    setResult(null);
    setRevokedKeyId(null);

    const id = requestId();
    const ts = Date.now();
    const msg = buildDerivJobKeyMessage({
      action: 'create_deriv_a2a_job_key',
      agentId: agentId.trim(),
      ownerAddress: wallet.address!,
      role,
      jobType,
      timestamp: ts,
      requestId: id,
    });

    let signature: string;
    try {
      signature = await signMessageAsync({ message: msg });
    } catch {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/a2a/deriv-job-agents/${encodeURIComponent(agentId.trim())}/keys/create`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          ownerAddress: wallet.address, signature, timestamp: ts, role, jobType, requestId: id,
        })},
      );
      setResult(await res.json());
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'create_failed' });
    } finally {
      setLoading(false);
    }
  }, [wallet, agentId, role, jobType, signMessageAsync]);

  // ── Rotate now (revoke all + create new) ───────────────────────────────────

  const rotateNow = useCallback(async () => {
    setResult(null);
    setRevokedKeyId(null);

    const id = requestId();
    const ts = Date.now();
    const msg = buildDerivJobKeyMessage({
      action: 'rotate_deriv_a2a_job_key',
      agentId: agentId.trim(),
      ownerAddress: wallet.address!,
      role,
      jobType,
      timestamp: ts,
      requestId: id,
    });

    let signature: string;
    try {
      signature = await signMessageAsync({ message: msg });
    } catch {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/a2a/deriv-job-agents/${encodeURIComponent(agentId.trim())}/keys/rotate`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          ownerAddress: wallet.address, signature, timestamp: ts, role, jobType, requestId: id,
        })},
      );
      setResult(await res.json());
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'rotate_failed' });
    } finally {
      setLoading(false);
    }
  }, [wallet, agentId, role, jobType, signMessageAsync]);

  // ── Revoke one key ─────────────────────────────────────────────────────────

  const revokeKey = useCallback(async (keyId: string) => {
    setRevokedKeyId(null);

    const id = requestId();
    const ts = Date.now();
    const msg = buildDerivJobKeyMessage({
      action: 'revoke_deriv_a2a_job_key',
      agentId: agentId.trim(),
      ownerAddress: wallet.address!,
      role,
      jobType,
      timestamp: ts,
      requestId: id,
    });

    let signature: string;
    try {
      signature = await signMessageAsync({ message: msg });
    } catch {
      return;
    }

    try {
      const res = await fetch(
        `/api/a2a/deriv-job-agents/${encodeURIComponent(agentId.trim())}/keys/revoke`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          ownerAddress: wallet.address, signature, timestamp: ts, role, keyId, requestId: id,
        })},
      );
      const data = await res.json();
      if (data.ok) {
        setRevokedKeyId(keyId);
        // Refresh status
        setStatus((prev) =>
          prev ? { ...prev, keys: prev.keys.filter((k) => k.id !== keyId) } : prev,
        );
      } else {
        setResult(data as KeyActionResponse);
      }
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : 'revoke_failed' });
    }
  }, [wallet, agentId, role, jobType, signMessageAsync]);

  // ── Copy env ───────────────────────────────────────────────────────────────

  async function copyEnv() {
    if (!result?.ok) return;
    await navigator.clipboard.writeText(result.env);
    setCopied(true);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const RoleSelect = () => (
    <select
      value={role}
      onChange={(e) => setRole(e.target.value)}
      className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/60"
    >
      {policies.map((p) => (
        <option key={p.role} value={p.role}>
          {p.label} {!p.productionSafe ? '(demo only)' : ''}
        </option>
      ))}
    </select>
  );

  return (
    <main className="min-h-screen bg-[#05070b] px-6 py-10 text-white md:px-12 lg:px-24">
      <section className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.25em] text-cyan-300/80">
            ArcLayer · Bridge Rail x402
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Deriv A2A Job API Keys
          </h1>
          <p className="mt-3 text-sm leading-6 text-white/60">
            This manages ArcLayer API keys only. Deriv API tokens stay local to your VPS.
          </p>
        </div>

        {/* Wallet panel */}
        <div className="mb-5 rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-white/40">Connected wallet</div>
          <div className="mt-2 break-all font-mono text-sm text-white/80">
            {wallet.isConnected && wallet.address ? wallet.address : 'Not connected'}
          </div>
          <div className="mt-1 text-xs text-white/40">Mode: {wallet.mode ?? 'none'}</div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm text-white/70">Agent ID</span>
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="deriv-worker-001"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-sm text-white outline-none focus:border-cyan-300/60"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-white/70">Job Type</span>
            <input
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              placeholder="deriv_signal_analysis"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-sm text-white outline-none focus:border-cyan-300/60"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-white/70">Role</span>
            {policies.length > 0 ? <RoleSelect /> : (
              <select disabled className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/40">
                <option>Loading roles...</option>
              </select>
            )}
          </label>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!canSubmit || loading}
              onClick={checkStatus}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Check Keys
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={createReplacement}
              className="flex-1 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create Replacement Key
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={rotateNow}
              className="flex-1 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100 transition hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Rotate Now
            </button>
          </div>

          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs leading-5 text-white/40">
            <span className="font-medium text-white/60">Create Replacement Key:</span> Old keys stay active (you forgot the key but bot is still running).{' '}
            <span className="font-medium text-white/60">Rotate Now:</span> Revokes all old keys immediately (key leaked or bot is dead).
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="mt-6 rounded-xl border border-white/10 bg-black/40 p-4 text-center text-sm text-white/50">
            {isPending ? 'Signing with wallet...' : 'Processing...'}
          </div>
        )}

        {/* Error result */}
        {result && !result.ok && (
          <div className="mt-6 rounded-xl border border-red-400/20 bg-red-500/10 p-4">
            <div className="text-sm font-medium text-red-200">Failed</div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-red-100/80">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}

        {/* Key status list */}
        {status && status.keys.length > 0 && (
          <div className="mt-6 space-y-2">
            <div className="text-xs uppercase tracking-[0.2em] text-white/40">Active keys</div>
            {status.keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm text-cyan-100">{k.keyPrefix}...</div>
                  <div className="mt-0.5 text-xs text-white/40">
                    Scopes: {k.scopes.join(', ')} · Created: {new Date(k.createdAt).toLocaleDateString()}
                    {k.lastUsedAt ? ` · Last used: ${new Date(k.lastUsedAt).toLocaleDateString()}` : ' · Never used'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revokeKey(k.id)}
                  disabled={!canSubmit}
                  className="shrink-0 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}

        {status && status.keys.length === 0 && (
          <div className="mt-6 rounded-xl border border-white/5 bg-black/20 p-4 text-center text-sm text-white/30">
            No active keys for this agent.
          </div>
        )}

        {/* Revoke feedback */}
        {revokedKeyId && (
          <div className="mt-4 rounded-xl border border-green-400/20 bg-green-500/10 p-3 text-sm text-green-100">
            Key revoked successfully.
          </div>
        )}

        {/* Success result: key shown once + .env */}
        {result?.ok && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
              {result.mode === 'replacement'
                ? 'Old keys are still active. Copy the new key now — shown once.'
                : 'All previous keys revoked. Copy the new key now — shown once.'}
            </div>

            <div className="rounded-xl border border-white/10 bg-black/40 p-4">
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-white/40">
                New raw key
              </div>
              <pre className="overflow-x-auto rounded-lg bg-black/50 p-3 font-mono text-xs text-cyan-100">
                {result.key}
              </pre>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/40 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.2em] text-white/40">
                  Bot .env
                </div>
                <button
                  type="button"
                  onClick={copyEnv}
                  className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                >
                  {copied ? 'Copied' : 'Copy .env'}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-black/50 p-3 font-mono text-xs leading-5 text-white/80">
                {result.env}
              </pre>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-5 text-white/50">
              Key prefix: {result.keyMeta.keyPrefix} · Scopes: {result.keyMeta.scopes.join(', ')} · Role: {result.keyMeta.role}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
