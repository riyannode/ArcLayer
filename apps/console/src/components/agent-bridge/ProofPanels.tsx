import type { BridgeEvent, BridgeReceipt, BridgeSession } from './types';
import { eventType, roleLabel, shortHash } from './types';

const CORE_ROLES = ['oracle', 'analyzer', 'evaluator', 'executor'] as const;
const STALE_MS = 20 * 60 * 1000;
const ARCSCAN_TX = 'https://testnet.arcscan.app/tx/';

type CoreRole = (typeof CORE_ROLES)[number];

type OutputField = {
  label: string;
  value: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringifyValue).filter((item) => item !== '—').join(', ') || '—';
  const record = asRecord(value);
  if (!record) return '—';
  if (typeof record.reason === 'string') return record.reason;
  if (typeof record.action === 'string') return record.action;
  if (typeof record.summary === 'string') return record.summary;
  return Object.entries(record)
    .slice(0, 3)
    .map(([key, val]) => `${key}: ${stringifyValue(val)}`)
    .join(' · ');
}

function getNested(payload: Record<string, unknown> | null, keys: string[]): unknown {
  if (!payload) return undefined;
  for (const key of keys) {
    if (payload[key] !== undefined) return payload[key];
  }
  for (const branch of ['llm', 'output', 'result', 'decision', 'analysis']) {
    const nested = asRecord(payload[branch]);
    if (!nested) continue;
    for (const key of keys) {
      if (nested[key] !== undefined) return nested[key];
    }
  }
  return undefined;
}

function roleOutputFields(event: BridgeEvent | null | undefined): OutputField[] {
  if (!event) return [];
  const payload = asRecord(event.payload);
  const byRole: Record<CoreRole, OutputField[]> = {
    oracle: [],
    analyzer: [
      { label: 'summary', value: stringifyValue(getNested(payload, ['summary'])) },
      { label: 'rationale', value: stringifyValue(getNested(payload, ['rationale', 'reason'])) },
      { label: 'confidence', value: stringifyValue(getNested(payload, ['confidence'])) },
    ],
    evaluator: [
      { label: 'reason', value: stringifyValue(getNested(payload, ['reason', 'rationale'])) },
      { label: 'checks', value: stringifyValue(getNested(payload, ['checks'])) },
      { label: 'riskLevel', value: stringifyValue(getNested(payload, ['riskLevel', 'risk_level', 'risk'])) },
    ],
    executor: [
      { label: 'reason', value: stringifyValue(getNested(payload, ['reason', 'rationale'])) },
      { label: 'action', value: stringifyValue(getNested(payload, ['action'])) },
      { label: 'mockTrade', value: stringifyValue(getNested(payload, ['mockTrade', 'mock_trade'])) },
    ],
  };
  const role = event.role as CoreRole;
  return byRole[role] ?? [];
}

function fallbackField(event: BridgeEvent | null | undefined, key: 'usedFallback' | 'llmModel') {
  const payload = asRecord(event?.payload);
  const metadata = asRecord(event?.metadata);
  const candidates = key === 'usedFallback'
    ? ['usedFallback', 'used_fallback', 'fallback']
    : ['llmModel', 'llm_model', 'model'];
  return stringifyValue(getNested(payload, candidates) ?? getNested(metadata, candidates));
}

function formatAge(iso?: string | null) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'unknown';
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ${min % 60}m ago`;
}

function latestReceiptForHash(receipts: BridgeReceipt[], payloadHash?: string | null) {
  if (!payloadHash) return null;
  return [...receipts].reverse().find((receipt) => receipt.payload_hash === payloadHash) ?? null;
}

export function BotHealthPanel({ session }: { session: BridgeSession | null }) {
  const now = Date.now();
  return (
    <div className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Bot Health · PM2 Runtime</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {CORE_ROLES.map((role) => {
          const event = session?.roles?.[role] ?? null;
          const seenAt = event?.created_at ? new Date(event.created_at).getTime() : 0;
          const online = Boolean(event && Number.isFinite(seenAt) && now - seenAt <= STALE_MS);
          return (
            <div key={role} className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-[#F5F0E5]">{role}</div>
                <span className={`rounded-full border px-2 py-1 font-mono text-[9px] uppercase ${online ? 'border-emerald-300/35 bg-emerald-400/10 text-emerald-300' : 'border-amber-300/35 bg-amber-400/10 text-amber-200'}`}>
                  {online ? 'online' : 'stale'}
                </span>
              </div>
              <div className="mt-3 text-xs text-[#EAE4D8]/55">last seen: <span className="font-mono text-[#C5A67C]">{formatAge(event?.created_at)}</span></div>
              <div className="mt-1 text-xs text-[#EAE4D8]/45">hash: <span className="font-mono">{shortHash(event?.payload_hash)}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReceiptBreakdownPanel({ session }: { session: BridgeSession | null }) {
  const receipts = session?.receipts ?? [];
  const counts = {
    dry_run: receipts.filter((r) => r.receipt_type === 'dry_run').length,
    x402_arc_native: receipts.filter((r) => r.receipt_type === 'x402_arc_native').length,
    x402_circle_gateway: receipts.filter((r) => r.receipt_type === 'x402_circle_gateway').length,
  };
  const latest = receipts.at(-1) ?? null;
  return (
    <div className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Receipt Breakdown · Settlement Evidence</div>
      <div className="grid gap-3 md:grid-cols-3">
        {Object.entries(counts).map(([key, value]) => (
          <div key={key} className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
            <div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">{key}</div>
            <div className="mt-1 font-mono text-2xl text-[#F5F0E5]">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 rounded-sm border border-white/10 bg-black/20 p-3 text-xs text-[#EAE4D8]/60 md:grid-cols-3">
        <div>latest payment_id: <span className="font-mono text-[#C5A67C]">{shortHash(latest?.payment_id || latest?.payment_ref)}</span></div>
        <div>latest tx: <span className="font-mono text-[#C5A67C]">{shortHash(latest?.transaction)}</span></div>
        <div>{latest?.transaction ? <a href={`${ARCSCAN_TX}${latest.transaction}`} target="_blank" rel="noreferrer" className="font-mono text-[#C5A67C] underline-offset-4 hover:underline">ArcScan link ↗</a> : <span>ArcScan link: <span className="font-mono text-[#EAE4D8]/35">—</span></span>}</div>
      </div>
    </div>
  );
}

export function SessionTimelinePanel({ session }: { session: BridgeSession | null }) {
  const receipts = session?.receipts ?? [];
  const roles = CORE_ROLES.map((role) => session?.roles?.[role] ?? null);
  const hasEvents = roles.some(Boolean);
  return (
    <div className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Session Timeline · Event → x402 → Receipt</div>
      {!hasEvents ? (
        <div className="rounded-sm border border-dashed border-white/10 p-4 text-sm text-[#EAE4D8]/55">No oracle/analyzer/evaluator/executor events in the latest session yet.</div>
      ) : (
        <div className="space-y-2">
          {roles.map((event) => {
            if (!event) return null;
            const receipt = latestReceiptForHash(receipts, event.payload_hash);
            const x402 = event.role === 'oracle' ? false : Boolean(receipt && receipt.receipt_type !== 'dry_run');
            return (
              <div key={event.id} className="grid gap-3 rounded-sm border border-white/10 bg-white/[0.03] p-3 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                <div>
                  <div className="font-mono text-xs uppercase tracking-[0.14em] text-[#F5F0E5]">{roleLabel(event.role)} <span className="text-[#EAE4D8]/35">→</span> {x402 ? 'x402 → ' : ''}receipt</div>
                  <div className="mt-1 text-xs text-[#EAE4D8]/45">{eventType(event)}</div>
                </div>
                <div className="text-xs text-[#EAE4D8]/60">payloadHash: <span className="font-mono text-[#C5A67C]">{shortHash(event.payload_hash)}</span></div>
                <div className="text-xs text-[#EAE4D8]/60">createdAt: <span className="font-mono text-[#C5A67C]">{new Date(event.created_at).toLocaleString()}</span></div>
                <span className={`w-fit rounded-full border px-2 py-1 font-mono text-[9px] uppercase ${receipt ? 'border-emerald-300/35 bg-emerald-400/10 text-emerald-300' : 'border-white/15 bg-white/[0.03] text-[#EAE4D8]/45'}`}>{receipt?.receipt_type ?? 'pending'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LlmOutputPanel({ session }: { session: BridgeSession | null }) {
  const events = CORE_ROLES.filter((role) => role !== 'oracle').map((role) => session?.roles?.[role] ?? null).filter(Boolean) as BridgeEvent[];
  return (
    <div className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">LLM Output Display · Summaries Not Raw JSON</div>
      {events.length === 0 ? (
        <div className="rounded-sm border border-dashed border-white/10 p-4 text-sm text-[#EAE4D8]/55">No analyzer/evaluator/executor LLM outputs yet.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          {events.map((event) => (
            <div key={event.id} className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
              <div className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-[#F5F0E5]">{roleLabel(event.role)}</div>
              <div className="mt-3 space-y-2 text-xs text-[#EAE4D8]/65">
                {roleOutputFields(event).map((field) => (
                  <div key={field.label}><span className="text-[#EAE4D8]/40">{field.label}:</span> <span className="text-[#F5F0E5]">{field.value}</span></div>
                ))}
                <div><span className="text-[#EAE4D8]/40">usedFallback:</span> <span className="font-mono text-[#C5A67C]">{fallbackField(event, 'usedFallback')}</span></div>
                <div><span className="text-[#EAE4D8]/40">llmModel:</span> <span className="font-mono text-[#C5A67C]">{fallbackField(event, 'llmModel')}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
