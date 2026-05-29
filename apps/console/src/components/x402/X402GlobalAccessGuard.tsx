'use client';

import { type ReactNode, useCallback, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useX402Access } from '@/hooks/useX402Access';
import { useProtectionNotice, NOTICE_HOME_LOCKED } from '@/components/protection';

interface X402GlobalAccessGuardProps {
  children: ReactNode;
}

/**
 * X402GlobalAccessGuard
 *
 * Locks the public UI until the user unlocks the x402 protected resource.
 *
 * Important:
 * - This guard does NOT render an extra X402DemoPanel.
 * - The only active unlock panel is the existing homepage X402DemoPanel in HomeHero.
 * - API routes are not affected by this React guard.
 */
export default function X402GlobalAccessGuard({ children }: X402GlobalAccessGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { hasAccess, loading } = useX402Access();
  const { notify } = useProtectionNotice();

  const x402UiLockEnabled =
    process.env.NEXT_PUBLIC_X402_UI_LOCK_ENABLED !== 'false';

  const locked = x402UiLockEnabled && (loading || !hasAccess);
  const lockedHome = locked && pathname === '/';
  const lockedNonHome = locked && pathname !== '/';

  const handleLockedClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!lockedHome) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-x402-unlock-zone="true"]')) return;

      notify(NOTICE_HOME_LOCKED);

      document
        .querySelector('[data-x402-unlock-zone="true"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    [lockedHome, notify],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!x402UiLockEnabled) return;

    if (!loading && !hasAccess && pathname !== '/') {
      const returnPath =
        window.location.pathname + window.location.search + window.location.hash;

      sessionStorage.setItem('x402_return_to', returnPath);
      router.replace('/');
    }
  }, [x402UiLockEnabled, loading, hasAccess, pathname, router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!x402UiLockEnabled) {
      sessionStorage.removeItem('x402_return_to');
      return;
    }

    if (!hasAccess) return;

    const returnTo = sessionStorage.getItem('x402_return_to');

    if (
      returnTo &&
      returnTo !== '/' &&
      returnTo.startsWith('/') &&
      !returnTo.startsWith('//')
    ) {
      sessionStorage.removeItem('x402_return_to');
      router.replace(returnTo);
    }
  }, [x402UiLockEnabled, hasAccess, router]);

  return (
    <div
      className="relative min-h-screen"
      data-x402-locked-home={lockedHome ? 'true' : undefined}
      onClickCapture={handleLockedClick}
    >
      <div
        aria-hidden={lockedNonHome}
        className={
          lockedNonHome
            ? 'pointer-events-none select-none blur-[12px] brightness-[0.35] transition duration-300'
            : 'transition duration-300'
        }
      >
        {children}
      </div>
    </div>
  );
}
