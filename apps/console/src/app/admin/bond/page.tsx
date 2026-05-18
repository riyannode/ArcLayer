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
          <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.85)]">
            Owner-only. Update tier rates, flat fees, and the veteran discount on the BondConfig contract.
            Changes affect newly accepted jobs only — existing accepted jobs keep their on-chain bond.
          </p>
        </div>

        <AdminBondPanel />
      </div>
    </div>
  );
}
