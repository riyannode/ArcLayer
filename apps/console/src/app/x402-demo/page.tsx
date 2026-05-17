'use client';

import { useCircleWallet } from '@/hooks/useCircleWallet';
import { useAccount } from 'wagmi';
import { shortenAddress } from '@/lib/contracts';
import X402DemoPanel from '@/components/x402/X402DemoPanel';

export const dynamic = 'force-dynamic';

export default function X402DemoPage() {
  const { authenticated, address: circleAddress } = useCircleWallet();
  const { address: eoaAddress, isConnected: eoaConnected } = useAccount();
  const activeAuthed = eoaConnected || authenticated;
  const address = eoaAddress || circleAddress || '';

  return (
    <main className="min-h-screen bg-[#080808] px-4 py-6 text-[#EAE4D8] md:px-6 md:py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-col gap-3 border-b border-white/10 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-[0.24em] text-[#C5A67C]">ARCLAYER x402 MARKET</div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white md:text-5xl">Pay per API call</h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-white/80">
            <span className={activeAuthed ? 'h-2 w-2 rounded-full bg-green-400' : 'h-2 w-2 rounded-full bg-yellow-400'} />
            {activeAuthed && address ? `CONNECTED · ${shortenAddress(address)}` : 'Wallet not connected'}
          </div>
        </div>

        <X402DemoPanel />
      </div>
    </main>
  );
}
