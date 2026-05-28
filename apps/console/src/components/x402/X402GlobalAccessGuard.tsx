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
      const returnPath = window.location.pathname + window.location.search + window.location.hash;
      sessionStorage.setItem('x402_return_to', returnPath);
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
        <div className="fixed inset-0 z-[999] pointer-events-none">
          <div className="absolute inset-0 bg-[#050505]/45 backdrop-blur-[2px]" />

          <div className="relative h-full w-full">
            <div
              className="pointer-events-auto absolute top-0 left-0 right-0 px-3 pt-8 md:pl-[68px] md:pr-5 md:pt-9 lg:pl-[78px] xl:pl-[88px] 2xl:pl-[96px]"
            >
              <div className="grid min-h-[calc(100svh-80px)] grid-cols-1 gap-y-6 md:grid-cols-12 md:items-start md:gap-x-12 xl:gap-x-14 2xl:gap-x-16">
                {/* Left column — match homepage hero column */}
                <div className="md:col-span-5 md:max-w-[540px] md:justify-self-start md:pl-6 xl:pl-8">
                  <div className="flex max-w-[540px] flex-col justify-center">
                    {/* Spacer for hero text height */}
                    <div className="h-[260px] md:h-[280px]" />

                    <div className="mt-5">
                      <X402DemoPanel compact ticketOnly />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
