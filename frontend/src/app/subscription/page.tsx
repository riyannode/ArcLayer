import Link from 'next/link';

export default function SubscriptionBacklogPage() {
  return (
    <div className="relative px-6 py-24">
      <div className="mx-auto max-w-3xl">
        <p className="mb-3 text-xs font-light uppercase tracking-[0.24em] text-cyan-300/70">
          V2 backlog
        </p>
        <h1 className="text-[36px] font-light leading-tight md:text-[52px]">Retainer billing comes after escrow.</h1>
        <p className="mt-5 text-sm font-light leading-7 text-white/45">
          ArcWork V1 is locked to one product flow: create project, fund escrow, submit milestone, release USDC, and
          mint completed-work proof. Recurring retainers stay out of scope until the escrow workflow is shipped.
        </p>
        <Link href="/invoice" className="btn-primary mt-8 inline-block">
          Build V1 Project
        </Link>
      </div>
    </div>
  );
}
