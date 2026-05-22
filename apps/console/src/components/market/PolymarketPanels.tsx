'use client';

import type { LiveSnapshot } from '@/lib/markets/polymarket/types';

function money(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function timeLabel(sec?: number | null) {
  if (!sec) return '—';
  return new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-zinc-800 bg-[#111214] p-4"><div className="mb-3 text-[13px] font-semibold text-zinc-100">{title}</div>{children}</section>;
}

export function PolymarketBtc15mPanel({ snapshot, loading, error }: { snapshot: LiveSnapshot | null; loading?: boolean; error?: string | null }) {
  const livePrice = snapshot?.livePrice;
  const targetPrice = snapshot?.targetPrice;
  const upPrice = snapshot?.outcomes.up.probability;
  const downPrice = snapshot?.outcomes.down.probability;

  return <PanelShell title="Polymarket BTC 15m">
    {error ? <div className="mb-2 text-xs text-red-300">{error}</div> : null}
    <div className="font-mono text-xs text-zinc-400">{snapshot?.marketSlug || (loading ? 'Loading market…' : 'market unavailable')}</div>
    <div className="mt-2 text-xs text-zinc-500">{snapshot?.question || '—'}</div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded border border-zinc-700 p-2 text-emerald-300">UP {pct(upPrice)}</div><div className="rounded border border-zinc-700 p-2 text-red-300">DOWN {pct(downPrice)}</div></div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-300"><div>Live {typeof livePrice === 'number' ? money(livePrice) : 'Live price unavailable'}</div><div>Target {typeof targetPrice === 'number' ? money(targetPrice) : 'Target unavailable'}</div><div>Distance {money(snapshot?.distanceFromTarget)}</div><div>Direction {snapshot?.directionNow || '—'}</div></div>
    <div className="mt-2 text-xs text-zinc-500">window: {timeLabel(snapshot?.windowStart)} → {timeLabel(snapshot?.windowEnd)}</div>
  </PanelShell>;
}

export function PolymarketOrderbookPanel({ snapshot, loading }: { snapshot: LiveSnapshot | null; loading?: boolean }) {
  const upBook = snapshot?.orderbook.up;
  const downBook = snapshot?.orderbook.down;
  return <PanelShell title="UP / DOWN CLOB Orderbook">
    {loading && !snapshot ? <div className="mb-2 text-xs text-zinc-400">Loading orderbook…</div> : null}
    {([{ key: 'UP', book: upBook }, { key: 'DOWN', book: downBook }] as const).map(({ key, book }) => <div key={key} className="mb-2 rounded border border-zinc-800 p-2 text-xs"><div className="mb-1 font-mono uppercase text-zinc-300">{key}</div><div className="grid grid-cols-2 gap-1 text-zinc-400"><div>Best bid <span className="text-emerald-300">{pct(book?.bestBid)}</span></div><div>Best ask <span className="text-red-300">{pct(book?.bestAsk)}</span></div><div>Spread {pct(book?.spread)}</div><div>Depth {(book?.bidDepth || 0) + (book?.askDepth || 0)}</div></div></div>)}
  </PanelShell>;
}

export function PolymarketStyleBtcChart({ snapshot, loading, error }: { snapshot: LiveSnapshot | null; loading?: boolean; error?: string | null }) {
  const candles = snapshot?.candles1m ?? [];
  const hasCandles = candles.length > 0;
  const targetPrice = snapshot?.targetPrice ?? null;
  const livePrice = snapshot?.livePrice ?? null;
  const distance = typeof livePrice === 'number' && typeof targetPrice === 'number' ? livePrice - targetPrice : null;

  const prices = candles.flatMap((c) => [c.high, c.low]);
  if (typeof targetPrice === 'number') prices.push(targetPrice);
  if (typeof livePrice === 'number') prices.push(livePrice);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 1;
  const pad = Math.max((maxPrice - minPrice) * 0.12, 1);
  const low = minPrice - pad;
  const high = maxPrice + pad;
  const range = Math.max(high - low, 1);

  const width = 920; const height = 300; const leftPad = 8; const rightPad = 72; const topPad = 12; const bottomPad = 32;
  const chartW = width - leftPad - rightPad; const chartH = height - topPad - bottomPad;
  const y = (price: number) => topPad + ((high - price) / range) * chartH;
  const candleGap = 5;
  const candleW = hasCandles ? Math.max(5, Math.min(18, chartW / candles.length - candleGap)) : 8;
  const axisValues = Array.from({ length: 6 }, (_, i) => high - (range * i) / 5);
  const targetY = typeof targetPrice === 'number' ? y(targetPrice) : null;

  return <section className="rounded-2xl border border-white/10 bg-[#11161B] p-6 text-[#EAECEF]"><div className="flex flex-wrap gap-8"><div><div className="text-xs font-bold text-slate-500">Harga Target</div><div className="text-2xl font-black text-slate-400">{typeof targetPrice === 'number' ? money(targetPrice) : 'Target unavailable'}</div></div><div className="border-l border-white/10 pl-8"><div className="text-xs font-bold text-slate-400">Harga akhir</div><div className="text-2xl font-black text-white">{typeof livePrice === 'number' ? money(livePrice) : 'Live price unavailable'}{typeof distance === 'number' ? <span className={distance >= 0 ? 'ml-2 text-xs text-emerald-400' : 'ml-2 text-xs text-red-400'}>{distance >= 0 ? '▲' : '▼'} {money(Math.abs(distance))}</span> : null}</div></div><div className="border-l border-white/10 pl-8"><div className="text-xs font-bold text-slate-400">Market Odds</div><div className="mt-1 flex gap-2 text-xs font-bold"><span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-300">UP {pct(snapshot?.outcomes.up.probability)}</span><span className="rounded-full bg-red-500/15 px-3 py-1 text-red-300">DOWN {pct(snapshot?.outcomes.down.probability)}</span></div></div></div>
    <div className="relative mt-6 h-[330px] overflow-hidden rounded-xl border border-slate-700/40 bg-[#11161B]">{loading ? <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading live candle data…</div> : error ? <div className="flex h-full items-center justify-center text-sm text-red-300">{error}</div> : !hasCandles ? <div className="flex h-full items-center justify-center text-sm text-slate-400">Waiting for live candle data</div> : <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none">{axisValues.map((price) => { const yy = y(price); return <g key={price}><line x1={leftPad} x2={width - rightPad} y1={yy} y2={yy} stroke="rgba(71,85,105,0.45)" strokeWidth="1" /><text x={width - rightPad + 8} y={yy + 4} fill="rgba(148,163,184,0.75)" fontSize="11" fontWeight="700">{price.toFixed(2)}</text></g>; })}{targetY !== null ? <g><line x1={leftPad} x2={width - rightPad} y1={targetY} y2={targetY} stroke="#EF4444" strokeWidth="1" strokeDasharray="2 3" /></g> : null}{candles.map((c, i) => { const x = leftPad + i * (chartW / Math.max(candles.length - 1, 1)); const openY = y(c.open); const closeY = y(c.close); const highY = y(c.high); const lowY = y(c.low); const up = c.close >= c.open; const color = up ? '#22C55E' : '#EF4444'; const bodyY = Math.min(openY, closeY); const bodyH = Math.max(Math.abs(closeY - openY), 3); return <g key={`${c.timestamp}-${i}`}><line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth="1.5" /><rect x={x - candleW / 2} y={bodyY} width={candleW} height={bodyH} fill={color} rx="1" /></g>; })}</svg>}</div>
  </section>;
}
