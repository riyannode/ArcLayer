'use client';

import { type ReactNode } from 'react';
import { useX402Access } from '@/hooks/useX402Access';

interface X402ActionGateProps {
  children: ReactNode;
  /** Optional custom message when access is locked */
  lockedMessage?: string;
  /** If true, render children but disabled (opacity + pointer-events). Default: true */
  showDisabled?: boolean;
}

/**
 * X402ActionGate — wraps action buttons/sections.
 *
 * When user has NOT paid x402, children are rendered with reduced opacity
 * and pointer-events disabled, plus a "Pay to unlock" overlay hint.
 *
 * When user HAS paid, children render normally.
 */
export function X402ActionGate({
  children,
  lockedMessage = 'Pay via x402 to unlock actions',
  showDisabled = true,
}: X402ActionGateProps) {
  const { hasAccess, loading } = useX402Access();

  if (loading) {
    return <div className="opacity-50 pointer-events-none">{children}</div>;
  }

  if (hasAccess) {
    return <>{children}</>;
  }

  if (!showDisabled) {
    return (
      <div className="relative rounded-lg border border-[rgba(197,166,124,0.2)] bg-[rgba(0,0,0,0.3)] p-4 text-center">
        <p className="text-sm text-[rgba(234,228,216,0.6)]">{lockedMessage}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="opacity-40 pointer-events-none select-none" aria-disabled="true">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.4)] rounded-lg backdrop-blur-[2px]">
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[rgba(197,166,124,0.15)] border border-[rgba(197,166,124,0.3)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#C5A67C]">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="text-xs font-medium text-[#C5A67C]">{lockedMessage}</span>
        </div>
      </div>
    </div>
  );
}
