'use client';

import { useState, useEffect, useCallback } from 'react';

type ApiKeyMeta = {
  id: string;
  keyPrefix: string;
  label: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
};

const SCOPE_PRESETS: Record<string, { label: string; scopes: string[] }> = {
  worker: {
    label: 'Worker PM2 Bot',
    scopes: ['erc8183:claim', 'erc8183:running', 'erc8183:submit', 'erc8183:tx'],
  },
  client: {
    label: 'Client Job Creator',
    scopes: ['erc8183:create', 'erc8183:confirm', 'erc8183:tx'],
  },
  evaluator: {
    label: 'Evaluator Bot',
    scopes: ['erc8183:complete', 'erc8183:tx'],
  },
};

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AgentApiKeysSection({ agentId }: { agentId: string }) {
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create key state
  const [showCreate, setShowCreate] = useState(false);
  const [createLabel, setCreateLabel] = useState('');
  const [createPreset, setCreatePreset] = useState('worker');
  const [creating, setCreating] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [rawKeyId, setRawKeyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/agents/${agentId}/api-keys`);
      const data = await res.json();
      if (data.ok) {
        setKeys(data.keys);
      } else {
        setError(data.detail || 'Failed to load keys');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: createLabel.trim() || undefined,
          preset: createPreset,
        }),
      });
      const data = await res.json();
      if (data.ok && data.key) {
        setRawKey(data.key);
        setRawKeyId(data.id);
        setShowCreate(false);
        setCreateLabel('');
        fetchKeys();
      } else {
        setError(data.detail || data.error || 'Failed to create key');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm('Revoke this API key? Bots using it will stop working.')) return;
    try {
      const res = await fetch(`/api/agents/${agentId}/api-keys/${keyId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        fetchKeys();
      } else {
        setError(data.detail || 'Failed to revoke');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    }
  };

  const handleRotate = async (keyId: string) => {
    if (!confirm('Rotate this key? The old key will be revoked and a new one generated.')) return;
    try {
      const oldKey = keys.find((k) => k.id === keyId);
      // 1. Revoke old key first
      const revokeRes = await fetch(`/api/agents/${agentId}/api-keys/${keyId}`, { method: 'DELETE' });
      if (!revokeRes.ok) {
        const revokeData = await revokeRes.json().catch(() => ({}));
        setError(revokeData.detail || 'Failed to revoke old key');
        return;
      }
      // 2. Only create new key after revoke succeeds, preserving old scopes
      const res = await fetch(`/api/agents/${agentId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: oldKey?.label || undefined,
          scopes: oldKey?.scopes && oldKey.scopes.length > 0 ? oldKey.scopes : undefined,
          preset: oldKey?.scopes && oldKey.scopes.length > 0 ? undefined : 'worker',
        }),
      });
      const data = await res.json();
      if (data.ok && data.key) {
        setRawKey(data.key);
        setRawKeyId(data.id);
        fetchKeys();
      } else {
        setError(data.detail || 'Failed to create new key');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    }
  };

  const copyKey = async () => {
    if (!rawKey) return;
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const envSnippet = `ARCLAYER_API_KEY=${rawKey ?? 'ak_...'}
ARCLAYER_AGENT_ID=${agentId}
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_MODE=worker`;

  const copyEnv = async () => {
    await navigator.clipboard.writeText(envSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const dismissRawKey = () => {
    setRawKey(null);
    setRawKeyId(null);
  };

  return (
    <div className="space-y-5">
      {/* Raw key display (shown once after create/rotate) */}
      {rawKey && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-300">
            API Key Created
          </div>
          <div className="mt-2 rounded-md border border-rose-400/25 bg-rose-400/[0.06] px-4 py-3 text-[12px] leading-5 text-rose-200">
            Copy this key now. You will not be able to view it again.
          </div>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-[11px] text-[#F3C536]">
              {rawKey}
            </code>
            <button
              type="button"
              onClick={copyKey}
              className="h-10 shrink-0 rounded-md border border-[#F3C536]/35 bg-transparent px-4 text-[11px] font-semibold text-[#F3C536] transition hover:bg-[#F3C536]/8"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#EAE4D8]/45">
                .env snippet
              </span>
              <button
                type="button"
                onClick={copyEnv}
                className="font-mono text-[10px] text-[#F3C536] hover:text-[#FFE070]"
              >
                Copy .env
              </button>
            </div>
            <pre className="mt-1 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 font-mono text-[10px] leading-5 text-[#EAE4D8]/65">
              {envSnippet}
            </pre>
          </div>
          <button
            type="button"
            onClick={dismissRawKey}
            className="mt-3 text-[12px] text-[#EAE4D8]/55 hover:text-[#EAE4D8]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-rose-400/25 bg-rose-400/[0.06] px-4 py-3 text-[12px] text-rose-200">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-3 underline hover:text-rose-100"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-[14px] font-semibold text-[#F5F0E5]">Create API Key</h3>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-[11px] text-[#EAE4D8]/55 mb-1">Label (optional)</label>
              <input
                type="text"
                value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                placeholder="e.g. Production Worker"
                className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[13px] text-[#F5F0E5] placeholder:text-[#EAE4D8]/30"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#EAE4D8]/55 mb-1">Scope Preset</label>
              <select
                value={createPreset}
                onChange={(e) => setCreatePreset(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-[#080D13] px-3 py-2.5 text-[13px] text-[#F5F0E5]"
              >
                {Object.entries(SCOPE_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {preset.label} — {preset.scopes.join(', ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="h-10 rounded-md border border-[#F3C536] bg-[#F3C536] px-5 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070] disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Key'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="h-10 rounded-md border border-white/10 bg-transparent px-5 text-[12px] text-[#EAE4D8]/55 hover:text-[#EAE4D8]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create button */}
      {!showCreate && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="h-10 rounded-md border border-[#F3C536]/35 bg-transparent px-5 text-[12px] font-semibold text-[#F3C536] transition hover:border-[#F3C536]/70 hover:bg-[#F3C536]/8"
        >
          + Create API Key
        </button>
      )}

      {/* Key list */}
      {loading ? (
        <p className="text-[12px] text-[#EAE4D8]/55">Loading keys...</p>
      ) : keys.length === 0 ? (
        <p className="text-[12px] text-[#EAE4D8]/55">No API keys yet.</p>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="font-mono text-[12px] text-[#F3C536]">{k.keyPrefix}…</code>
                  <span
                    className={
                      k.status === 'active'
                        ? 'rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300'
                        : 'rounded border border-white/20 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#EAE4D8]/45'
                    }
                  >
                    {k.status}
                  </span>
                </div>
                {k.label && (
                  <p className="mt-1 text-[12px] text-[#EAE4D8]/70">{k.label}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {k.scopes.map((s) => (
                    <span
                      key={s}
                      className="rounded border border-[#F3C536]/15 bg-[#F3C536]/5 px-1.5 py-0.5 font-mono text-[9px] text-[#F3C536]/80"
                    >
                      {s}
                    </span>
                  ))}
                </div>
                <div className="mt-1 flex gap-3 font-mono text-[10px] text-[#EAE4D8]/40">
                  <span>Created {shortDate(k.createdAt)}</span>
                  {k.lastUsedAt && <span>Last used {shortDate(k.lastUsedAt)}</span>}
                </div>
              </div>

              {k.status === 'active' && (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => handleRotate(k.id)}
                    className="h-8 rounded-md border border-[#F3C536]/25 bg-transparent px-3 text-[10px] font-semibold uppercase tracking-wider text-[#F3C536] transition hover:bg-[#F3C536]/8"
                  >
                    Rotate Key
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevoke(k.id)}
                    className="h-8 rounded-md border border-rose-500/25 bg-transparent px-3 text-[10px] font-semibold uppercase tracking-wider text-rose-300 transition hover:bg-rose-500/10"
                  >
                    Revoke Key
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
