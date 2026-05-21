import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGINS = new Set([
  'https://arclayers.xyz',
  'https://www.arclayers.xyz',
  'http://localhost:3000',
  'http://localhost:3001',
]);

const CANONICAL_ORIGIN = 'https://arclayers.xyz';
const MAINTENANCE_MODE = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === 'true';

function isMaintenanceAllowedPath(pathname: string): boolean {
  return (
    pathname === '/maintenance' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/icon-192.png' ||
    pathname === '/icon-512.png' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml'
  );
}

/**
 * Build CORS headers. ALWAYS sets Access-Control-Allow-Origin explicitly to
 * override any wildcard injected by upstream proxies/Vercel defaults.
 * - Allowed origin → echo it back
 * - Disallowed/missing origin → pin to canonical site (effectively blocks cross-origin)
 */
function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = !!origin && ALLOWED_ORIGINS.has(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin! : CANONICAL_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,authorization,x-arc-wallet,x-arc-nonce,x-arc-timestamp,x-arc-signature',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin');
  const { pathname } = req.nextUrl;

  if (req.method === 'OPTIONS') {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new NextResponse(null, { status: 403 });
    }
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (MAINTENANCE_MODE && !isMaintenanceAllowedPath(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/maintenance';
    return NextResponse.rewrite(url);
  }

  const res = NextResponse.next();
  const headers = corsHeaders(origin);
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: ['/api/:path*', '/((?!.*\\..*).*)'],
};
