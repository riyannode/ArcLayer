'use client';

import { useEffect, useState } from 'react';

type Level = { price?: number | string; size?: number | string };
type Book = { bids?: Level[]; asks?: Level[]; mid?: number | string | null };
type Payload = { up?: Book; down?: Book; fetchedAt?: string; payloadHash?: string; error?: string };

function n(v: unknown) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function fmt(v: unknown) { const x = Number(v); return Number.isFinite(x) ? x.toFixed(3) : '—'; }

function BookSide({ title, book }: { title: string; book?: Book }) {
  const rows = [...(book?.bids || []).slice(0, 5).map((r) => ({ ...r, side: 'bid' })), ...(book?.asks || []).slice(0, 5).map((r) => ({ ...r, side: 'ask' }))];
  const max = Math.max(1, ...rows.map((r) => n(r.size)));
  return (
    <div className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em]"><span className="text-[#F5F0E5]">{title}</span><span className="text-[#C5A67C]">mid {fmt(book?.mid)}</span></div>
      <div className="space-y-1.5">
        {rows.length === 0 ? <div className="text-xs text-[#EAE4D8]/45">No depth.</div> : rows.map((row, idx) => (
          <div key={`${row.side}-${idx}`} className="relative overflow-hidden rounded-sm border border-white/5 bg-black/25 px-2 py-1.5 font-mono text-[10px]">
            <div className={`absolute inset-y-0 left-0 ${row.side === 'bid' ? 'bg-emerald-400/10' : 'bg-red-400/10'}`} style={{ width: `${Math.max(4, (n(row.size) / max) * 100)}%` }} />
            <div className="relative flex justify-between gap-3"><span className={row.side === 'bid' ? 'text-emerald-300' : 'text-red-300'}>{row.side}</span><span>{fmt(row.price)}</span><span className="text-[#EAE4D8]/55">{fmt(row.size)}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PolymarketOrderbookPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    async function load() {
      try { const res = await fetch('/api/data/polymarket/btc-15m/orderbook', { cache: 'no-store' }); const next = await res.json().catch(() => ({})); if (!alive) return; setData(next); setError(res.ok ? null : next?.error || `HTTP ${res.status}`); }
      catch (err) { if (alive) setError(err instanceof Error ? err.message : 'orderbook_fetch_failed'); }
    }
    load(); const id = setInterval(load, 10_000); return () => { alive = false; clearInterval(id); };
  }, []);
  return <section className="rounded-sm border border-white/10 bg-black/25 p-4"><div className="mb-3 flex items-center justify-between"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Orderbook</div><div className="font-mono text-[10px] text-[#EAE4D8]/45">{data?.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : '—'}</div></div>{error ? <div className="mb-3 rounded-sm border border-amber-400/20 bg-amber-950/20 p-3 text-xs text-amber-100">{error}</div> : null}<div className="grid gap-3 md:grid-cols-2"><BookSide title="UP side" book={data?.up} /><BookSide title="DOWN side" book={data?.down} /></div></section>;
}
