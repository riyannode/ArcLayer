'use client';

import { useMemo } from 'react';
import { useCryptoUpDownLive } from '@/hooks/useCryptoUpDownLive';

function num(value?: number | null, digits = 2, prefix = '') { return typeof value === 'number' && Number.isFinite(value) ? `${prefix}${value.toFixed(digits)}` : '—'; }
function pct(value?: number | null) { return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'; }
function t(sec?: number) { return sec ? new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'; }

function PanelShell({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-xl border border-zinc-800 bg-[#111214] p-4"><div className="mb-3 text-[13px] font-semibold text-zinc-100">{title}</div>{children}</section>; }

export function PolymarketBtc15mPanel() {
  const { data } = useCryptoUpDownLive('BTC');
  return <PanelShell title="Polymarket BTC 15m">
    <div className="font-mono text-xs text-zinc-400">{data?.marketSlug || 'market unavailable'}</div>
    <div className="mt-2 text-xs text-zinc-500">{data?.question || '—'}</div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
      <div className="rounded border border-zinc-700 p-2 text-emerald-300">UP {pct(data?.outcomes.up.probability)}</div>
      <div className="rounded border border-zinc-700 p-2 text-red-300">DOWN {pct(data?.outcomes.down.probability)}</div>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-300"><div>Live {num(data?.livePrice, 2, '$')}</div><div>Target {num(data?.targetPrice, 2, '$')}</div><div>Distance {num(data?.distanceFromTarget, 2, '$')}</div><div>Direction {data?.directionNow || '—'}</div></div>
    <div className="mt-2 text-xs text-zinc-500">window: {t(data?.windowStart)} → {t(data?.windowEnd)}</div>
  </PanelShell>;
}

export function PolymarketOrderbookPanel() {
  const { data } = useCryptoUpDownLive('BTC');
  return <PanelShell title="UP / DOWN CLOB Orderbook">
    {(['up', 'down'] as const).map((side) => { const b = data?.orderbook[side]; return <div key={side} className="mb-2 rounded border border-zinc-800 p-2 text-xs"><div className="mb-1 font-mono uppercase text-zinc-300">{side}</div><div className="grid grid-cols-2 gap-1 text-zinc-400"><div>Best bid <span className="text-emerald-300">{pct(b?.bestBid)}</span></div><div>Best ask <span className="text-red-300">{pct(b?.bestAsk)}</span></div><div>Spread {pct(b?.spread)}</div><div>Depth {num((b?.bidDepth || 0) + (b?.askDepth || 0), 2)}</div></div></div>; })}
  </PanelShell>;
}

export function BtcCandlestickPanel() {
  const { data } = useCryptoUpDownLive('BTC');
  const candles = useMemo(() => (data?.candles1m || []).slice(-40), [data]);
  const min = Math.min(...candles.map((c) => c.low), data?.targetPrice ?? Number.POSITIVE_INFINITY);
  const max = Math.max(...candles.map((c) => c.high), data?.targetPrice ?? Number.NEGATIVE_INFINITY);
  const range = Math.max(1, max - min);
  const y = (price: number) => `${((price - min) / range) * 100}%`;
  return <PanelShell title="BTC 1m Candlestick">
    <div className="relative h-44 rounded border border-zinc-800 bg-[#0D0E10] p-2">
      {typeof data?.targetPrice === 'number' ? <div className="absolute left-0 right-0 border-t border-amber-300/60" style={{ bottom: y(data.targetPrice) }} /> : null}
      <div className="flex h-full items-end gap-1">{candles.map((c) => <div key={c.timestamp} className={`relative w-2 ${c.close >= c.open ? 'text-emerald-300' : 'text-red-300'}`}><div className="absolute left-1/2 w-px -translate-x-1/2 bg-current" style={{ bottom: y(c.low), height: `calc(${y(c.high)} - ${y(c.low)})` }} /><div className="absolute w-full bg-current" style={{ bottom: y(Math.min(c.open, c.close)), height: `calc(${y(Math.max(c.open, c.close))} - ${y(Math.min(c.open, c.close))} + 2px)` }} /></div>)}</div>
    </div>
  </PanelShell>;
}
