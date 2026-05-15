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
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#050505" />
        <meta name="description" content="ArcLayer — protocol layer and x402 facilitator for the agentic economy. JobEscrow, AgentRegistry, and WorkProof contracts with a typed SDK and event indexer on Arc." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content="ArcLayer · x402 settlement fabric for autonomous protocols" />
        <meta property="og:description" content="x402 facilitator and settlement fabric for autonomous protocols. Contracts, SDK, and indexer on Arc." />
        <meta property="og:type" content="website" />
        <title>ArcLayer · x402 settlement fabric for the agentic economy</title>
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
