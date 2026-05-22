'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Session = { id: string; createdAt?: string; mode?: string };
type Event = { role?: string; type?: string; createdAt?: string; payloadHash?: string };
type Receipt = { id?: string; amount?: string; status?: string; createdAt?: string };

export default function PredictionMarketBotsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  useEffect(() => {
    (async () => {
      const latest = await fetch('/api/agent-bridge/sessions/latest').then((r) => r.json()).catch(() => null);
      if (!latest?.id) return;
      setSession(latest);
      const [ev, rc] = await Promise.all([
        fetch(`/api/agent-bridge/events?sessionId=${latest.id}`).then((r) => r.json()).catch(() => []),
        fetch(`/api/agent-bridge/receipts?sessionId=${latest.id}`).then((r) => r.json()).catch(() => []),
      ]);
      setEvents(Array.isArray(ev) ? ev : []);
      setReceipts(Array.isArray(rc) ? rc : []);
    })();
  }, []);

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-6 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
        <header className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">← A2A Agent Bridge</Link>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5]">Prediction Market Bots</h1>
        </header>
        <section className="rounded-md border border-white/10 bg-[#0A0A0A]/90 p-5 text-sm">
          <div>Session: {session?.id ?? 'No active session'}</div>
          <div className="mt-2">Events: {events.length} · Receipts: {receipts.length}</div>
          <div className="mt-4 space-y-2">
            {events.slice(0, 12).map((event, idx) => (
              <div key={`${event.payloadHash ?? idx}`} className="border border-white/10 p-2">
                <div>{event.role} · {event.type}</div>
                <div className="text-xs opacity-70">{event.createdAt}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
