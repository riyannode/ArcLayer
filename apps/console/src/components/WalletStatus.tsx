'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCircleWallet } from '@/hooks/useCircleWallet';
import { shortenAddress } from '@/lib/contracts';

type Variant = 'landing' | 'app';

interface Props {
  variant?: Variant;
}

/**
 * Wallet status control. Context-aware via `variant`:
 *   - landing: CTA-first. Disconnected shows CONNECT WALLET; once connected
 *     it becomes OPEN CONSOLE — push the user into the app.
 *   - app: Dashboard chrome. Disconnected shows CONNECT WALLET; connected
 *     shows the address pill + DISCONNECT.
 *
 * Backed by Circle Modular Wallets (passkey-based smart accounts).
 * First-time users see a register modal (passkey creation); returning
 * users tap CONNECT and authenticate biometrically.
 */
export default function WalletStatus({ variant = 'app' }: Props) {
  const { ready, authenticated, address, login, register, logout } =
    useCircleWallet();
  const [showRegister, setShowRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handleConnect = async () => {
    setErr('');
    setBusy(true);
    try {
      // Try login first; fall back to register if no passkey exists.
      await login();
    } catch (e) {
      // No passkey on this device — show register modal.
      setShowRegister(true);
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async () => {
    if (!username.trim()) {
      setErr('Username required');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await register(username.trim());
      setShowRegister(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

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

  // Landing: after connect, drive the user into /protocol.
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
    <>
      <button
        onClick={handleConnect}
        disabled={busy}
        className="btn-primary"
        style={{ padding: '10px 18px', fontSize: '11px' }}
      >
        {busy ? 'CONNECTING…' : 'CONNECT WALLET'}
      </button>

      {showRegister && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => !busy && setShowRegister(false)}
        >
          <div
            className="w-full max-w-md p-8 font-mono"
            style={{
              background: '#0a0a0a',
              border: '1px solid rgba(197, 166, 124, 0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              className="mb-2 text-xs tracking-[0.18em]"
              style={{ color: '#C5A67C' }}
            >
              CREATE WALLET
            </h2>
            <p className="mb-4 text-[11px] leading-relaxed text-white/60">
              ArcLayer uses Circle Modular Wallets with passkey authentication.
              Choose a username and approve with your device biometrics.
            </p>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              disabled={busy}
              className="mb-3 w-full px-3 py-2 text-[12px] text-white"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                outline: 'none',
              }}
              autoFocus
            />
            {err && (
              <p className="mb-3 text-[10px]" style={{ color: '#ff6464' }}>
                {err}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleRegister}
                disabled={busy}
                className="btn-primary flex-1"
                style={{ padding: '10px 18px', fontSize: '11px' }}
              >
                {busy ? 'CREATING…' : 'CREATE PASSKEY'}
              </button>
              <button
                onClick={() => setShowRegister(false)}
                disabled={busy}
                className="px-3 py-2 text-[10px] tracking-[0.18em] text-white/40"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
