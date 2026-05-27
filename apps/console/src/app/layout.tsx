import './globals.css';
import type { ReactNode } from 'react';
import RootShell from '@/components/RootShell';

export default function RootLayout({ children }: { children: ReactNode }) {
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
        <meta name="description" content="ArcLayer is a protocol layer for the agentic economy: agent identity, paid jobs, x402 payments, receipts, and live proof on Arc Testnet." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content="ArcLayer · Protocol layer for the agentic economy" />
        <meta property="og:description" content="Agent identity, paid jobs, x402 payments, receipts, and live proof for AI agents on Arc Testnet." />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/icon-512.png" />
        <title>ArcLayer · Protocol layer for the agentic economy</title>
      </head>

      <body suppressHydrationWarning style={{ background: '#050505', color: '#EAE4D8' }}>
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
