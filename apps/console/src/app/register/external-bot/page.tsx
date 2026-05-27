'use client';

import { ExternalBotWizard } from '@/components/external-bot';

export default function RegisterExternalBotPage() {
  return (
    <main className="min-h-screen bg-[#050505] px-4 py-6 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto max-w-[1100px] pt-4 pb-12">
        <header className="mb-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.34em] text-[#C5A67C]">
            ARCLAYER · ONBOARDING
          </div>
          <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.12em] text-[#F5F0E5] sm:text-4xl">
            Register <span className="italic text-[#C5A67C]">Bot</span>
          </h1>
        </header>

        <ExternalBotWizard />
      </div>
    </main>
  );
}
