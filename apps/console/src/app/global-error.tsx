'use client';

import { useEffect } from 'react';

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ArcLayer global error]', error);
    }
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#050505', color: '#EAE4D8' }}>
        <main style={{ minHeight: '100vh', padding: '48px 16px', background: '#050505' }}>
          <div
            style={{
              maxWidth: 760,
              margin: '0 auto',
              border: '1px solid rgba(197,166,124,0.22)',
              background: 'rgba(10,10,10,0.96)',
              padding: 24,
              color: '#EAE4D8',
            }}
          >
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 10,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                color: '#C5A67C',
              }}
            >
              ArcLayer Global Runtime Guard
            </div>

            <h1
              style={{
                marginTop: 12,
                marginBottom: 0,
                color: '#F5F0E5',
                fontSize: 28,
                lineHeight: 1.1,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
              }}
            >
              Application shell degraded
            </h1>

            <p style={{ marginTop: 14, color: 'rgba(234,228,216,0.72)', lineHeight: 1.6 }}>
              A root-level browser error was contained. Retry the application shell or return home.
            </p>

            {error.digest ? (
              <p style={{ marginTop: 12, fontFamily: 'monospace', fontSize: 11, color: 'rgba(234,228,216,0.45)' }}>
                digest: {error.digest}
              </p>
            ) : null}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 22 }}>
              <button
                type="button"
                onClick={reset}
                style={{
                  border: '1px solid rgba(197,166,124,0.42)',
                  background: 'rgba(197,166,124,0.10)',
                  color: '#C5A67C',
                  padding: '10px 14px',
                  fontFamily: 'monospace',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.16em',
                  cursor: 'pointer',
                }}
              >
                Retry shell
              </button>

              <a
                href="/"
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(234,228,216,0.75)',
                  padding: '10px 14px',
                  fontFamily: 'monospace',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.16em',
                  textDecoration: 'none',
                }}
              >
                Back home
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
