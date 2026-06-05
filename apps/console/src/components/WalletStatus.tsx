'use client';

import { useState } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { shortenAddress } from '@/lib/contracts';

type Variant = 'landing' | 'app';

interface Props {
  variant?: Variant;
}

/**
 * Wallet status control. EOA only.
 *
 *   - landing: CTA-first. Disconnected shows CONNECT WALLET; once connected
 *     shows address pill + DISCONNECT.
 *   - app: Dashboard chrome. Disconnected shows CONNECT WALLET; connected
 *     shows the address pill + DISCONNECT.
 *
 * Owner Wallet is always EOA via Reown/wagmi.
 * Circle (passkey) does NOT define global connected state.
 * Circle is reserved for Agent Account flows only.
 */
export default function WalletStatus({ variant = 'app' }: Props) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { open: openAppKit } = useAppKit();

  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyAddress = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  const handleConnect = () => {
    setBusy(true);
    try {
      openAppKit();
    } finally {
      setBusy(false);
    }
  };

  // Landing: after connect, show address pill.
  if (variant === 'landing' && isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => copyAddress(address)}
          title="Copy full address"
          className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] transition hover:brightness-125"
          style={{
            background: 'rgba(197, 166, 124, 0.08)',
            color: '#C5A67C',
            border: '1px solid rgba(197, 166, 124, 0.25)',
          }}
        >
          <span className="pulse-dot" />
          <span className="text-[9px] tracking-[0.14em] text-white/80">EOA</span>
          {shortenAddress(address)}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 text-white/50">
            <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
            <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.44A1.5 1.5 0 008.378 6H4.5z" />
          </svg>
        </button>
        <button
          onClick={() => disconnect()}
          className="px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-white/80 transition-all duration-300"
          style={{ border: '1px solid rgba(255, 255, 255, 0.08)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255,100,100,0.5)';
            e.currentTarget.style.color = '#ff6464';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.4)';
          }}
        >
          DISCONNECT
        </button>
      </div>
    );
  }

  // App: full session chrome (address pill + disconnect).
  if (variant === 'app' && isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => copyAddress(address)}
          title="Copy full address"
          className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] transition hover:brightness-125"
          style={{
            background: 'rgba(197, 166, 124, 0.08)',
            color: '#C5A67C',
            border: '1px solid rgba(197, 166, 124, 0.25)',
          }}
        >
          <span className="pulse-dot" />
          <span className="text-[9px] tracking-[0.14em] text-white/80">EOA</span>
          {shortenAddress(address)}
          {copied ? (
            <span className="font-mono text-[9px] tracking-[0.14em] text-emerald-400">COPIED</span>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 text-white/50">
              <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
              <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.44A1.5 1.5 0 008.378 6H4.5z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => disconnect()}
          className="px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-white/80 transition-all duration-300"
          style={{ border: '1px solid rgba(255, 255, 255, 0.08)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255,100,100,0.5)';
            e.currentTarget.style.color = '#ff6464';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.4)';
          }}
        >
          DISCONNECT
        </button>
      </div>
    );
  }

  // Disconnected — single CONNECT WALLET button → opens EOA wallet directly.
  return (
    <button
      onClick={handleConnect}
      disabled={busy}
      className="btn-primary"
      style={{ padding: '10px 18px', fontSize: '11px' }}
    >
      {busy ? 'CONNECTING…' : 'CONNECT WALLET'}
    </button>
  );
}
