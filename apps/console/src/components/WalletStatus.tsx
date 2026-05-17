'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCircleWallet } from '@/hooks/useCircleWallet';
import { useAccount, useDisconnect } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
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
 * Supports dual auth: Circle Modular Wallets (passkey) + EOA via Reown AppKit.
 */
export default function WalletStatus({ variant = 'app' }: Props) {
  const { ready, authenticated, address: circleAddress, login, register, logout } =
    useCircleWallet();
  const { address: eoaAddress, isConnected: eoaConnected } = useAccount();
  const { disconnect: eoaDisconnect } = useDisconnect();
  const { open: openAppKit } = useAppKit();

  const [showPicker, setShowPicker] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Determine which wallet is active
  const isConnected = authenticated || eoaConnected;
  const activeAddress = authenticated ? circleAddress : eoaConnected ? eoaAddress : null;
  const walletType = authenticated ? 'passkey' : eoaConnected ? 'eoa' : null;

  const handlePasskeyConnect = async () => {
    setShowPicker(false);
    setErr('');
    setBusy(true);
    try {
      await login();
    } catch {
      setShowRegister(true);
    } finally {
      setBusy(false);
    }
  };

  const handleEoaConnect = () => {
    setShowPicker(false);
    openAppKit();
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

  const handleDisconnect = () => {
    if (walletType === 'passkey') {
      logout();
    } else {
      eoaDisconnect();
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
  if (variant === 'landing' && isConnected && activeAddress) {
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
  if (variant === 'app' && isConnected && activeAddress) {
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
          <span className="text-[9px] tracking-[0.14em] text-white/40">{walletType === 'eoa' ? 'EOA' : 'PASSKEY'}</span>
          {shortenAddress(activeAddress)}
        </div>
        <button
          onClick={handleDisconnect}
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

  // Disconnected — CONNECT WALLET opens a compact picker directly below the button.
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setShowPicker((v) => !v)}
        disabled={busy}
        className="btn-primary"
        style={{ padding: '10px 18px', fontSize: '11px' }}
      >
        {busy ? 'CONNECTING…' : 'CONNECT WALLET'}
      </button>

      {/* Wallet type picker dropdown */}
      {showPicker && (
        <div
          className="absolute right-0 top-full z-50 mt-3 w-[320px] max-w-[calc(100vw-24px)] p-4 font-mono shadow-2xl"
          style={{
            background: '#0a0a0a',
            border: '1px solid rgba(197, 166, 124, 0.25)',
          }}
        >
          <h2
            className="mb-3 text-[10px] tracking-[0.18em]"
            style={{ color: '#C5A67C' }}
          >
            CHOOSE WALLET
          </h2>
          <div className="space-y-2">
            <button
              onClick={handlePasskeyConnect}
              className="w-full rounded-xl border border-[#C5A67C]/40 px-4 py-3 text-left transition-all hover:border-[#C5A67C]/70 hover:bg-[#C5A67C]/5"
            >
              <div className="text-[11px] tracking-[0.14em] text-[#C5A67C]">PASSKEY (CIRCLE)</div>
              <div className="mt-1 text-[10px] text-white/40">Biometric smart account — no extension needed</div>
            </button>
            <button
              onClick={handleEoaConnect}
              className="w-full rounded-xl border border-white/20 px-4 py-3 text-left transition-all hover:border-white/40 hover:bg-white/[0.03]"
            >
              <div className="text-[11px] tracking-[0.14em] text-white/80">EOA WALLET</div>
              <div className="mt-1 text-[10px] text-white/40">MetaMask, Coinbase, WalletConnect</div>
            </button>
          </div>
          <button
            onClick={() => setShowPicker(false)}
            className="mt-3 w-full py-2 text-[10px] tracking-[0.18em] text-white/30 hover:text-white/50"
          >
            CANCEL
          </button>
        </div>
      )}

      {/* Passkey register modal (fallback when no passkey exists) */}
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
    </div>
  );
}
