'use client';

import { AdminBondPanel } from '@/components/vault/AdminBondPanel';

export default function AdminBondPage() {
  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-8">
          <div className="aureo-mono-label mb-3">PROTOCOL · ADMIN</div>
          <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
            Bond <span className="italic text-[#C5A67C]">Configuration</span>
          </h1>
          <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.85)] invisible">
            Owner-only settings for job bonds and fees.
            Changes apply only to new accepted jobs.
          </p>
        </div>

        <AdminBondPanel />
      </div>
    </div>
  );
}
