'use client';

import './globals.css';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400..700&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#000000" />
        <meta name="description" content="ArcWork Protocol — milestone payments for real freelance work, settled in USDC on Arc." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>ArcWork Protocol - Milestone payments for real freelance work</title>
      </head>
      <body style={{ background: '#000', color: '#FFF' }}>
        <WebGLBackground />
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <div className="relative z-10 min-h-screen flex flex-col">
              <Navbar />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}
