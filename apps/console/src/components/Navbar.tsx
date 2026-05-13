'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { shortenAddress } from '@/lib/contracts';
import { useState, useEffect, useCallback } from 'react';
import ArcMark from './ArcMark';

export default function Navbar() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  const navLinks = [
    { href: '/dashboard', label: 'PROTOCOL' },
    { href: '/jobs', label: 'JOBS' },
    { href: '/agents', label: 'AGENTS' },
    { href: '/docs', label: 'SDK' },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setWalletModalOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (isConnected) setWalletModalOpen(false); }, [isConnected]);

  const handleConnect = useCallback((connector: typeof connectors[number]) => {
    connect({ connector });
  }, [connect]);

  const walletOptions = connectors.map((connector) => ({
    id: connector.uid,
    name: connector.name,
    description: connector.id === 'walletConnect'
      ? 'Scan with mobile wallets via WalletConnect'
      : connector.id === 'coinbaseWalletSDK'
      ? 'Use Coinbase Wallet extension or mobile app'
      : 'Connect with an injected EVM wallet',
    connector,
    recommended: connector.id === 'injected' || connector.id === 'metaMaskSDK',
  }));

  return (
    <>
      <nav
        className="sticky top-0 z-50 border-b border-white/10 backdrop-blur-xl transition-all duration-500"
        style={{
          background: 'rgba(5, 5, 5, 0.85)',
          height: scrolled ? '60px' : '72px',
        }}
      >
        <div className="mx-auto flex h-full w-full max-w-screen-2xl items-center justify-between px-5 transition-all duration-500 md:px-10">
          {/* Brand — logo + wordmark */}
          <Link href="/" className="group flex items-center gap-3" aria-label="ArcLayer home">
            <div className="relative transition-transform duration-300 group-hover:scale-105">
              <ArcMark size={scrolled ? 26 : 30} />
            </div>
            <div className="flex flex-col leading-none">
              <span
                className="aureo-body text-[#EAE4D8]"
                style={{ fontSize: '15px', letterSpacing: '0.24em', fontWeight: 400 }}
              >
                ARCLAYER
              </span>
              <span className="mt-1 hidden font-mono text-[9px] tracking-[0.2em] text-[#C5A67C] md:block">
                PROTOCOL · AGENTIC ECONOMY
              </span>
            </div>
          </Link>

          {/* Desktop Links */}
          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => {
              const isActive = pathname === link.href || pathname.startsWith(link.href + '/');
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="relative px-4 py-2 transition-all duration-300"
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '11px',
                    letterSpacing: '0.24em',
                    fontWeight: 400,
                    color: isActive ? '#EAE4D8' : '#7A7A7A',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = '#C5A67C'; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = '#7A7A7A'; }}
                >
                  {link.label}
                  {isActive && (
                    <span
                      className="absolute bottom-0 left-1/2 h-[1px] w-6 -translate-x-1/2"
                      style={{ background: '#C5A67C', boxShadow: '0 0 8px rgba(197, 166, 124, 0.8)' }}
                    />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Wallet + Mobile */}
          <div className="flex items-center gap-3">
            {isConnected ? (
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
                  {shortenAddress(address || '')}
                </div>
                <button
                  onClick={() => disconnect()}
                  className="px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-white/40 transition-all duration-300"
                  style={{ border: '1px solid rgba(255, 255, 255, 0.08)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,100,100,0.5)'; e.currentTarget.style.color = '#ff6464'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
                >
                  DISCONNECT
                </button>
              </div>
            ) : (
              <button
                onClick={() => setWalletModalOpen(true)}
                className="btn-primary"
                style={{ padding: '10px 18px', fontSize: '11px' }}
              >
                CONNECT WALLET
              </button>
            )}

            <button
              className="md:hidden flex flex-col gap-1.5 p-2"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={menuOpen}
            >
              <span className="h-[1.5px] w-5 transition-all duration-300" style={{ background: '#C5A67C', transform: menuOpen ? 'rotate(45deg) translateY(4px)' : 'none' }} />
              <span className="h-[1.5px] w-5 transition-all duration-300" style={{ background: '#C5A67C', opacity: menuOpen ? 0 : 1 }} />
              <span className="h-[1.5px] w-5 transition-all duration-300" style={{ background: '#C5A67C', transform: menuOpen ? 'rotate(-45deg) translateY(-4px)' : 'none' }} />
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <div
          className="md:hidden overflow-hidden transition-all duration-400"
          style={{
            maxHeight: menuOpen ? '320px' : '0',
            opacity: menuOpen ? 1 : 0,
            borderTop: menuOpen ? '1px solid rgba(255,255,255,0.08)' : 'none',
            background: 'rgba(5, 5, 5, 0.96)',
          }}
        >
          <div className="px-6 py-5 space-y-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="block py-3 px-4 transition-all duration-200"
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '11px',
                    letterSpacing: '0.24em',
                    color: isActive ? '#C5A67C' : 'rgba(234, 228, 216, 0.7)',
                    background: isActive ? 'rgba(197, 166, 124, 0.08)' : 'transparent',
                    borderLeft: isActive ? '2px solid #C5A67C' : '2px solid transparent',
                  }}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Wallet Modal */}
      {walletModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => setWalletModalOpen(false)}>
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md aureo-glass p-8 animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
            style={{ borderColor: 'rgba(197, 166, 124, 0.25)' }}
          >
            <button
              onClick={() => setWalletModalOpen(false)}
              className="absolute right-5 top-5 flex h-7 w-7 items-center justify-center font-mono text-xs transition-colors duration-200"
              style={{ color: '#7A7A7A', border: '1px solid rgba(255, 255, 255, 0.1)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#EAE4D8'; e.currentTarget.style.borderColor = 'rgba(197, 166, 124, 0.4)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#7A7A7A'; e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'; }}
              aria-label="Close wallet modal"
            >
              ×
            </button>

            <div className="mb-6">
              <div className="aureo-mono-label mb-2">CONNECT · WALLET</div>
              <h3 className="aureo-display text-[32px] text-[#EAE4D8]">Enter the <span className="italic text-[#C5A67C]">protocol</span></h3>
              <p className="mt-3 font-mono text-[11px] leading-5 text-white/45">
                Select an injected wallet. Arc Testnet will be added if missing.
              </p>
            </div>

            {error && (
              <div
                className="mb-4 p-3 font-mono text-[11px]"
                style={{ background: 'rgba(255, 80, 80, 0.08)', border: '1px solid rgba(255, 80, 80, 0.2)', color: '#ff8080' }}
              >
                {error.message.includes('User rejected')
                  ? 'Connection rejected. Retry when ready.'
                  : error.message.includes('already pending')
                  ? 'Pending connection — check your wallet.'
                  : error.message}
              </div>
            )}

            <div className="space-y-3">
              {walletOptions.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={() => handleConnect(wallet.connector!)}
                  disabled={isPending}
                  className="group w-full flex items-center gap-4 p-4 text-left transition-all duration-300"
                  style={{
                    background: 'rgba(197, 166, 124, 0.04)',
                    border: '1px solid rgba(197, 166, 124, 0.2)',
                    opacity: isPending ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isPending) {
                      e.currentTarget.style.background = 'rgba(197, 166, 124, 0.1)';
                      e.currentTarget.style.borderColor = 'rgba(197, 166, 124, 0.5)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(197, 166, 124, 0.04)';
                    e.currentTarget.style.borderColor = 'rgba(197, 166, 124, 0.2)';
                  }}
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(197, 166, 124, 0.3)' }}>
                    <ArcMark size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[#EAE4D8]">{wallet.name}</span>
                      {wallet.recommended && (
                        <span className="px-2 py-0.5 font-mono text-[9px] tracking-[0.15em]" style={{ background: 'rgba(184, 205, 126, 0.12)', color: '#B8CD7E' }}>
                          RECOMMENDED
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[10.5px] text-white/35">{wallet.description}</span>
                  </div>
                  <span className="font-mono text-xs text-[#C5A67C]">→</span>
                </button>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2 pt-5" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
              {[
                ['NETWORK', 'Arc Testnet'],
                ['CHAIN ID', '5042002'],
                ['EXPLORER', 'ArcScan'],
                ['TOKEN', 'Testnet USDC'],
              ].map(([label, value]) => (
                <div key={label} className="p-3" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <p className="aureo-mono-label" style={{ fontSize: '9px' }}>{label}</p>
                  <p className="mt-1 font-mono text-[11px] text-[#C5A67C]">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
