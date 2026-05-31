'use client';

import { type ReactNode, useCallback, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useX402Access } from '@/hooks/useX402Access';
import { useProtectionNotice, NOTICE_HOME_LOCKED } from '@/components/protection';

interface X402GlobalAccessGuardProps {
  children: ReactNode;
}

type X402UiLockMode = 'off' | 'app-only' | 'full';

function getX402UiLockMode(): X402UiLockMode {
  const mode = process.env.NEXT_PUBLIC_X402_UI_LOCK_MODE;

  if (mode === 'off' || mode === 'app-only' || mode === 'full') {
    return mode;
  }

  // Backward compatibility with old env.
  if (process.env.NEXT_PUBLIC_X402_UI_LOCK_ENABLED === 'false') {
    return 'off';
  }

  // Safe default: homepage public, app gated.
  return 'app-only';
}

function isPublicPath(pathname: string) {
  return (
    pathname === '/' ||
    pathname === '/docs'
  );
}

export default function X402GlobalAccessGuard({ children }: X402GlobalAccessGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { hasAccess, loading } = useX402Access();
  const { notify } = useProtectionNotice();

  const x402UiLockMode = getX402UiLockMode();
  const publicPath = isPublicPath(pathname);

  const locked =
    x402UiLockMode !== 'off' &&
    (loading || !hasAccess) &&
    (x402UiLockMode === 'full' || !publicPath);

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
    if (x402UiLockMode === 'off') return;

    const currentPath = window.location.pathname;
    const currentPublicPath = isPublicPath(currentPath);

    if (
      !loading &&
      !hasAccess &&
      currentPath !== '/' &&
      (x402UiLockMode === 'full' || !currentPublicPath)
    ) {
      const returnPath =
        window.location.pathname + window.location.search + window.location.hash;

      sessionStorage.setItem('x402_return_to', returnPath);
      router.replace('/');
    }
  }, [x402UiLockMode, loading, hasAccess, pathname, router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (x402UiLockMode === 'off') {
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
  }, [x402UiLockMode, hasAccess, router]);

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
