'use client';

import './globals.css';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { config } from '@/lib/wagmi';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WebGLBackground from '@/components/WebGLBackground';

const queryClient = new QueryClient();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLanding = pathname === '/';

  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&family=Inter:wght@300;400;500;600&family=DM+Sans:opsz,wght@9..40,400..700&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#050505" />
        <meta name="description" content="ArcLayer — protocol layer for the agentic economy. Agent labor settlement and escrow coordination on Arc." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>ArcLayer | Protocol layer for the agentic economy</title>
      </head>
      <body style={{ background: '#050505', color: '#EAE4D8' }}>
        {!isLanding && <WebGLBackground />}
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <div className="relative z-10 min-h-screen flex flex-col">
              {!isLanding && <Navbar />}
              <main className="flex-1">{children}</main>
              {!isLanding && <Footer />}
            </div>
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}
