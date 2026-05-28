'use client';

import dynamic from 'next/dynamic';
import { type ReactNode, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useX402Access } from '@/hooks/useX402Access';

const X402DemoPanel = dynamic(() => import('@/components/x402/X402DemoPanel'), {
  ssr: false,
  loading: () => (
    <div className="h-[220px] w-full max-w-[440px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
  ),
});

interface X402GlobalAccessGuardProps {
  children: ReactNode;
}

export default function X402GlobalAccessGuard({ children }: X402GlobalAccessGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { hasAccess, loading } = useX402Access();

  const locked = loading || !hasAccess;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!loading && !hasAccess && pathname !== '/') {
      sessionStorage.setItem('x402_return_to', pathname);
      router.replace('/');
    }
  }, [loading, hasAccess, pathname, router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hasAccess) return;

    const returnTo = sessionStorage.getItem('x402_return_to');

    if (returnTo && returnTo !== '/') {
      sessionStorage.removeItem('x402_return_to');
      router.replace(returnTo);
    }
  }, [hasAccess, router]);

  return (
    <div className="relative min-h-screen">
      <div
        aria-hidden={locked}
        className={
          locked
            ? 'pointer-events-none select-none blur-[12px] brightness-[0.35] transition duration-300'
            : 'transition duration-300'
        }
      >
        {children}
      </div>

      {locked && pathname === '/' && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-[#050505]/70 backdrop-blur-[3px]" />

          <div className="relative z-10 w-full max-w-[440px]">
            <div className="mb-4 text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#C5A67C]">
                x402 protected access
              </div>

              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[#EAE4D8]">
                Unlock ArcLayer
              </h2>

              <p className="mt-2 text-xs leading-5 text-white/60">
                Connect wallet and complete x402 payment to open the full protocol UI.
              </p>
            </div>

            <X402DemoPanel compact ticketOnly />
          </div>
        </div>
      )}
    </div>
  );
}
