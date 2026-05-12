'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { shortenAddress } from '@/lib/contracts';
import { useState, useEffect, useCallback } from 'react';

export default function Navbar() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  const navLinks = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/job/0', label: 'Jobs' },
    { href: '/agent/1', label: 'Agents' },
    { href: '/docs', label: 'Docs' },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close modal on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setWalletModalOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close modal when connected
  useEffect(() => {
    if (isConnected) setWalletModalOpen(false);
  }, [isConnected]);

  const handleConnect = useCallback((connector: typeof connectors[number]) => {
    connect({ connector });
  }, [connect]);

  const walletOptions = [
    {
      id: 'injected',
      name: 'MetaMask / Browser Wallet',
      icon: 'account_balance_wallet',
      description: 'Connect with MetaMask or any injected wallet',
      connector: connectors.find(c => c.id === 'injected'),
      recommended: true,
    },
  ].filter(w => w.connector); // Only show available connectors

  return (
    <>
      <nav 
        className="sticky top-0 z-50 border-b border-[#2d3a3b] bg-[#121414]/88 backdrop-blur-md transition-all duration-500"
        style={{ 
          borderRadius: 0, 
          height: scrolled ? '56px' : '64px',
          boxShadow: 'none',
        }}
      >
        <div className="mx-auto flex h-full w-full max-w-screen-2xl items-center justify-between px-5 transition-all duration-500 md:px-8">
          {/* Logo */}
          <Link href="/" className="group flex items-center gap-2.5" aria-label="ArcLayer home">
            <div className="relative">
              <img 
                src="/logo.png" 
                alt="" 
                className="h-7 w-7 rounded-md object-cover transition-all duration-300 group-hover:scale-105" 
                style={{ border: '1.5px solid rgba(85,223,231,0.24)' }} 
              />
              <div 
                className="absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ boxShadow: '0 0 0 1px rgba(85,223,231,0.18)' }}
              />
            </div>
            <span className="font-[var(--font-display)] text-xl font-bold tracking-[-0.04em] md:text-[22px]" style={{ color: '#55dfe7' }}>
              ArcLayer
            </span>
          </Link>

          {/* Desktop Links */}
          <div className="hidden items-center gap-2 md:flex">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={`${link.label}-${link.href}`}
                  href={link.href}
                  className="relative rounded-sm px-3 py-2 text-sm font-semibold transition-all duration-300"
                  style={{ 
                    color: isActive ? '#55dfe7' : 'rgba(185,202,203,0.9)',
                    background: isActive ? 'rgba(85,223,231,0.07)' : 'transparent',
                  }}
                  onMouseEnter={(e) => { 
                    if (!isActive) {
                      e.currentTarget.style.color = '#55dfe7';
                      e.currentTarget.style.background = 'rgba(85,223,231,0.04)';
                    }
                  }}
                  onMouseLeave={(e) => { 
                    if (!isActive) {
                      e.currentTarget.style.color = 'rgba(185,202,203,0.9)';
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {link.label}
                  {isActive && (
                    <span 
                      className="absolute bottom-0 left-1/2 h-[2px] w-4 -translate-x-1/2 rounded-sm"
                      style={{ background: '#55dfe7' }}
                    />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Wallet + Mobile Menu */}
          <div className="flex items-center gap-3">
            {isConnected ? (
              <div className="flex items-center gap-2">
                <div 
                  className="flex items-center gap-2 rounded-md px-4 py-2 text-xs font-light"
                  style={{ 
                    background: 'rgba(0,240,255,0.08)', 
                    color: '#00F0FF', 
                    border: '1px solid rgba(0,240,255,0.15)' 
                  }}
                >
                  <span className="pulse-dot" />
                  {shortenAddress(address || '')}
                </div>
                <button
                  onClick={() => disconnect()}
                  className="rounded-md px-3 py-2 text-xs font-light transition-all duration-300"
                  style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.1)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,100,100,0.5)'; e.currentTarget.style.color = '#ff6464'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setWalletModalOpen(true)} 
                className="rounded-md bg-[#55dfe7] px-4 py-2.5 text-sm font-semibold text-[#121414] transition-colors duration-200 hover:bg-[#8ceff4] md:px-5"
              >
                <span className="material-symbols-outlined align-middle text-[18px]" aria-hidden="true">account_balance_wallet</span>
                <span className="ml-2 align-middle">Connect Wallet</span>
              </button>
            )}

            {/* Mobile hamburger */}
            <button 
              className="md:hidden flex flex-col gap-1.5 p-2"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={menuOpen}
            >
              <span 
                className="h-[1.5px] w-5 rounded-sm transition-all duration-300"
                style={{ 
                  background: 'rgba(255,255,255,0.6)',
                  transform: menuOpen ? 'rotate(45deg) translateY(4px)' : 'none'
                }}
              />
              <span 
                className="h-[1.5px] w-5 rounded-sm transition-all duration-300"
                style={{ 
                  background: 'rgba(255,255,255,0.6)',
                  opacity: menuOpen ? 0 : 1
                }}
              />
              <span 
                className="h-[1.5px] w-5 rounded-sm transition-all duration-300"
                style={{ 
                  background: 'rgba(255,255,255,0.6)',
                  transform: menuOpen ? 'rotate(-45deg) translateY(-4px)' : 'none'
                }}
              />
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <div 
          className="md:hidden overflow-hidden transition-all duration-400"
          style={{ 
            maxHeight: menuOpen ? '300px' : '0',
            opacity: menuOpen ? 1 : 0,
            borderTop: menuOpen ? '1px solid rgba(255,255,255,0.06)' : 'none',
          }}
        >
          <div className="px-6 py-4 space-y-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={`${link.label}-${link.href}`}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="block py-2.5 px-4 rounded-lg text-sm font-light transition-all duration-200"
                  style={{ 
                    color: isActive ? '#55dfe7' : 'rgba(255,255,255,0.55)',
                    background: isActive ? 'rgba(85,223,231,0.08)' : 'transparent',
                  }}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* ─── Wallet Selection Modal ─── */}
      {walletModalOpen && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={() => setWalletModalOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          
          {/* Modal */}
          <div 
            className="relative w-full max-w-md glass-card p-6 animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button 
              onClick={() => setWalletModalOpen(false)}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-200"
              style={{ background: 'rgba(255,255,255,0.06)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              aria-label="Close wallet modal"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true" style={{ color: 'rgba(255,255,255,0.5)' }}>close</span>
            </button>

            {/* Header */}
            <div className="mb-6">
              <h3 className="text-lg font-medium mb-1">Connect Wallet</h3>
              <p className="text-xs font-light" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Choose a wallet to connect to Arc Testnet
              </p>
              <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-white/45">
                New to Arc? You can explore demo mode without connecting.
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div 
                className="mb-4 p-3 rounded-xl text-xs font-light"
                style={{ 
                  background: 'rgba(255,80,80,0.1)', 
                  border: '1px solid rgba(255,80,80,0.2)',
                  color: '#ff6464',
                }}
              >
                {error.message.includes('User rejected') 
                  ? 'Connection was rejected. Please try again.' 
                  : error.message.includes('already pending')
                  ? 'Connection request already pending. Check your wallet.'
                  : error.message}
              </div>
            )}

            {/* Wallet Options */}
            <div className="space-y-3">
              {walletOptions.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={() => handleConnect(wallet.connector!)}
                  disabled={isPending}
                  className="w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-300 text-left group"
                  style={{ 
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    opacity: isPending ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => { 
                    if (!isPending) {
                      e.currentTarget.style.background = 'rgba(0,240,255,0.06)';
                      e.currentTarget.style.borderColor = 'rgba(0,240,255,0.2)';
                    }
                  }}
                  onMouseLeave={(e) => { 
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                  }}
                >
                  <div 
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 transition-transform duration-300 group-hover:scale-110"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                  >
                    <span className="material-symbols-outlined text-[21px] text-[#55dfe7]" aria-hidden="true">{wallet.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-normal">{wallet.name}</span>
                      {wallet.recommended && (
                        <span 
                          className="rounded-md px-2 py-0.5 text-[10px] font-light"
                          style={{ background: 'rgba(0,255,136,0.1)', color: 'rgba(0,255,136,0.8)' }}
                        >
                          Recommended
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-extralight" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {wallet.description}
                    </span>
                  </div>
                  <div 
                    className="text-xs font-light transition-colors duration-200"
                    style={{ color: 'rgba(255,255,255,0.2)' }}
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Network info */}
            <div 
              className="mt-5 grid grid-cols-2 gap-2 pt-4"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              {[
                ['Network', 'Arc Testnet'],
                ['Chain ID', '5042002'],
                ['Explorer', 'ArcScan'],
                ['Token', 'Testnet USDC'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">{label}</p>
                  <p className="mt-1 font-mono text-[11px] text-cyan-100/80">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
