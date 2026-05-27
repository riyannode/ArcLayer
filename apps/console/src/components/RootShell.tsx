'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import Providers from '@/components/Providers';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WebGLBackground from '@/components/WebGLBackground';
import { ProtectionNoticeProvider } from '@/components/protection';
import ClientErrorBoundary from '@/components/ClientErrorBoundary';

export default function RootShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === '/';

  return (
    <>
      {!isLanding ? (
        <ClientErrorBoundary label="WebGL background" fallback={null}>
          <WebGLBackground />
        </ClientErrorBoundary>
      ) : null}

      <ClientErrorBoundary label="Application providers">
        <Providers>
          <ClientErrorBoundary label="Protection notice">
            <ProtectionNoticeProvider>
              <div className="relative z-10 min-h-screen flex flex-col">
                <ClientErrorBoundary label="Navigation" fallback={null}>
                  <Navbar />
                </ClientErrorBoundary>

                <main key={pathname} className="flex-1 page-transition">
                  {children}
                </main>

                {!isLanding ? (
                  <ClientErrorBoundary label="Footer" fallback={null}>
                    <Footer />
                  </ClientErrorBoundary>
                ) : null}
              </div>
            </ProtectionNoticeProvider>
          </ClientErrorBoundary>
        </Providers>
      </ClientErrorBoundary>
    </>
  );
}
