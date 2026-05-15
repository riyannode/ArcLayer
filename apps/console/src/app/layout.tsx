'use client';

import './globals.css';
import { usePathname } from 'next/navigation';
import Providers from '@/components/Providers';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WebGLBackground from '@/components/WebGLBackground';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === '/';

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
        <link rel="icon" href="/icon-512.png" type="image/png" sizes="512x512" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#050505" />
        <meta name="description" content="ArcLayer — payment infrastructure for agents ready to ship. Add x402 payments, USDC escrow, Proof of Work, and reputation to any AI agent or API." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content="ArcLayer · Payment infrastructure for agents ready to ship" />
        <meta property="og:description" content="Add x402 payments, USDC escrow, Proof of Work, and reputation to any AI agent or API — without rebuilding payment and settlement logic from scratch." />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/icon-512.png" />
        <title>ArcLayer · Payment infrastructure for agents ready to ship</title>
      </head>
      <body suppressHydrationWarning style={{ background: '#050505', color: '#EAE4D8' }}>
        {!isLanding && <WebGLBackground />}
        <Providers>
          <div className="relative z-10 min-h-screen flex flex-col">
            <Navbar />
            <main key={pathname} className="flex-1 page-transition">{children}</main>
            {!isLanding && <Footer />}
          </div>
        </Providers>
      </body>
    </html>
  );
}
