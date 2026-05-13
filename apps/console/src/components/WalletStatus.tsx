'use client';

import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { shortenAddress } from '@/lib/contracts';

type Variant = 'landing' | 'app';

interface Props {
  variant?: Variant;
}

/**
 * Wallet status control. Context-aware via `variant`:
 *   - landing: CTA-first. Disconnected shows CONNECT WALLET; once connected
 *     it becomes OPEN CONSOLE — the user has a wallet, push them into the app.
 *   - app: Dashboard chrome. Disconnected shows CONNECT WALLET; connected
 *     shows the address pill + DISCONNECT (the existing in-app behavior).
 *
 * The dichotomy is deliberate: on a marketing landing the primary CTA after
 * wallet-connect is *enter the product*, not manage session. DISCONNECT is
 * still reachable from any app page where it belongs.
 */
export default function WalletStatus({ variant = 'app' }: Props) {
  const { ready, authenticated, user, login, logout } = usePrivy();

  const address =
    user?.wallet?.address ||
    user?.linkedAccounts?.find((acc) => acc.type === 'wallet')?.address ||
    '';

  if (!ready) {
    return (
      <div
        className="px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-white/40"
        style={{ border: '1px solid rgba(255, 255, 255, 0.08)' }}
      >
        LOADING…
      </div>
    );
  }

  // Landing: after connect, drive the user into /dashboard.
  if (variant === 'landing' && authenticated && address) {
    return (
      <Link
        href="/protocol"
        className="btn-primary"
        style={{ padding: '10px 18px', fontSize: '11px', fontWeight: 600 }}
      >
        OPEN CONSOLE →
      </Link>
    );
  }

  // App: full session chrome (address pill + disconnect).
  if (variant === 'app' && authenticated && address) {
    return (
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-2 px-3 py-2 font-mono text-[11px]"
          style={{
            background: 'rgba(197, 166, 124, 0.08)',
            color: '#C5A67C',
            border: '1px solid rgba(197, 166, 124, 0.25)',
          }}
        >
          <span className="pulse-dot" />
          {shortenAddress(address)}
        </div>
        <button
          onClick={() => logout()}
          className="px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-white/40 transition-all duration-300"
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

  // Disconnected — same CTA in both contexts.
  return (
    <button
      onClick={login}
      className="btn-primary"
      style={{ padding: '10px 18px', fontSize: '11px' }}
    >
      CONNECT WALLET
    </button>
  );
}
