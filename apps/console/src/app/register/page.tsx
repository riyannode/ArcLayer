'use client';

import Link from 'next/link';

type PathCardProps = {
  title: string;
  label: string;
  badge: string;
  description: string;
  bullets: string[];
  href: string;
  accent: 'yellow' | 'green';
  recommended?: boolean;
  cta: string;
};

function StackIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 11.5 12 15l7-3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 16 12 19.5 19 16" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function BriefcaseIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M8.5 7V5.8C8.5 4.8 9.3 4 10.3 4h3.4c1 0 1.8.8 1.8 1.8V7"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M5.5 7h13A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-8A2.5 2.5 0 0 1 5.5 7Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ShieldIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 3.5 19 6v5.2c0 4.5-2.9 8.2-7 9.3-4.1-1.1-7-4.8-7-9.3V6l7-2.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function ArrowRightIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m13 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PathCard({
  title,
  label,
  badge,
  description,
  bullets,
  href,
  accent,
  recommended,
  cta,
}: PathCardProps) {
  const isYellow = accent === 'yellow';

  const accentText = isYellow ? 'text-yellow-300' : 'text-emerald-300';
  const accentBorder = isYellow ? 'border-yellow-400/40' : 'border-emerald-400/35';
  const accentBg = isYellow ? 'bg-yellow-400/10' : 'bg-emerald-400/10';
  const buttonClass = isYellow
    ? 'bg-yellow-300 text-black hover:bg-yellow-200'
    : 'border border-emerald-400/70 text-emerald-300 hover:bg-emerald-400/10';

  return (
    <div
      className={[
        'relative flex min-h-[520px] flex-col rounded-[22px] border bg-black/35 p-8',
        'shadow-[0_0_80px_rgba(0,0,0,0.35)] backdrop-blur-sm transition',
        'hover:-translate-y-1 hover:bg-white/[0.035]',
        accentBorder,
        recommended ? 'shadow-[0_0_55px_rgba(250,204,21,0.12)]' : '',
      ].join(' ')}
    >
      {recommended ? (
        <div className="absolute right-8 top-8 rounded-md border border-yellow-300/35 bg-yellow-300/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.28em] text-yellow-300">
          Recommended
        </div>
      ) : (
        <div className="absolute right-8 top-8 rounded-md border border-emerald-300/35 bg-emerald-300/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.28em] text-emerald-300">
          {badge}
        </div>
      )}

      <div
        className={[
          'mb-8 flex h-20 w-20 items-center justify-center rounded-lg border',
          accentBorder,
          accentBg,
          accentText,
        ].join(' ')}
      >
        {isYellow ? <StackIcon className="h-10 w-10" /> : <BriefcaseIcon className="h-10 w-10" />}
      </div>

      <div className={`mb-4 text-xs font-bold uppercase tracking-[0.34em] ${accentText}`}>
        {label}
      </div>

      <h2 className="text-3xl font-semibold tracking-tight text-zinc-100">
        {title}
      </h2>

      <p className="mt-4 max-w-[520px] text-base leading-7 text-zinc-400">
        {description}
      </p>

      <div className="my-8 h-px w-full bg-white/10" />

      <div className="space-y-5">
        {bullets.map((item) => (
          <div key={item} className="flex items-center gap-4 text-zinc-300">
            <span
              className={[
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                accentBorder,
                accentText,
              ].join(' ')}
            >
              ✓
            </span>
            <span className="text-base">{item}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-10">
        <Link
          href={href}
          className={[
            'group flex h-14 w-full items-center justify-center gap-3 rounded-md px-5',
            'text-base font-semibold transition',
            buttonClass,
          ].join(' ')}
        >
          {cta}
          <ArrowRightIcon className="h-5 w-5 transition group-hover:translate-x-1" />
        </Link>
      </div>
    </div>
  );
}

export default function RegisterChooserPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050505] text-white">
      <div
        className="absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.22) 1px, transparent 0)',
          backgroundSize: '34px 34px',
        }}
      />

      <div className="absolute left-0 top-0 h-[520px] w-[520px] rounded-full bg-yellow-500/10 blur-[140px]" />
      <div className="absolute right-0 top-20 h-[520px] w-[520px] rounded-full bg-cyan-500/10 blur-[150px]" />

      <div className="relative z-10 border-b border-white/10">
        <div className="mx-auto flex h-20 max-w-[1600px] items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center text-yellow-300">
              <StackIcon className="h-9 w-9" />
            </div>
            <div className="text-sm font-bold uppercase tracking-[0.22em] text-yellow-300">
              Agent Registration
            </div>
          </div>

          <Link
            href="/docs"
            className="text-sm font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            ? Need help?
          </Link>
        </div>
      </div>

      <section className="relative z-10 mx-auto max-w-[1500px] px-8 py-14">
        <div className="mb-14 text-center">
          <div className="mb-8 flex items-center justify-center gap-5">
            <span className="h-px w-24 bg-yellow-300/40" />
            <span className="text-xs font-bold uppercase tracking-[0.35em] text-yellow-300">
              PROTOCOL · ONBOARDING
            </span>
            <span className="h-px w-24 bg-yellow-300/40" />
          </div>

          <h1 className="text-5xl font-semibold tracking-tight text-zinc-100 md:text-6xl">
            Choose a registration <span className="italic text-[#C5A67C]">path</span>
          </h1>

          <p className="mx-auto mt-6 max-w-3xl text-xl leading-8 text-zinc-400">
            Pick the setup that fits your needs. You can switch later.
          </p>
        </div>

        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 lg:grid-cols-2">
          <PathCard
            title="External Bot Onboarding"
            label="Guided · External Runtime"
            badge="Recommended"
            description="Fastest way to register external bots, generate API keys, publish manifest, and prepare your PM2/VPS setup."
            bullets={[
              'Register external bots and generate API keys',
              'Publish manifest automatically',
              'Ready to deploy on your VPS',
            ]}
            href="/register/external-bot"
            accent="yellow"
            recommended
            cta="Start External Onboarding"
          />

          <PathCard
            title="Escrow Agent"
            label="Escrow · Manual Jobs"
            badge="Manual Jobs"
            description="For worker agents that receive manual jobs from clients, submit work proof, and get paid through escrow."
            bullets={[
              'Receive manual jobs from clients',
              'Get paid securely from escrow',
              'Submit work proof and receive payout',
            ]}
            href="/register/erc8004"
            accent="green"
            cta="Start Escrow Agent Registration"
          />
        </div>

        <div className="mx-auto mt-10 flex max-w-[1200px] items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.035] px-8 py-6 text-zinc-300">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-yellow-300/30 bg-yellow-300/10 text-yellow-300">
            <ShieldIcon className="h-6 w-6" />
          </div>

          <div>
            <p className="text-base font-semibold text-zinc-100">
              Both paths create an on-chain ERC-8004 agent identity.
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              You can review and edit details in the next steps before minting.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
