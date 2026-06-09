import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_ERROR_BODY = { error: 'internal_error' } as const;

function sanitizeJsonBody(body: unknown): unknown {
  if (body instanceof Error) {
    return PUBLIC_ERROR_BODY;
  }

  if (Array.isArray(body)) {
    return body.map((item) => sanitizeJsonBody(item));
  }

  if (body && typeof body === 'object' && Object.getPrototypeOf(body) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(body).map(([key, value]) => [key, sanitizeJsonBody(value)]),
    );
  }

  return body;
}

function wantsPrettyJson(req: NextRequest | Request): boolean {
  const url = 'nextUrl' in req ? req.nextUrl : new URL(req.url);
  const pretty = url.searchParams.get('pretty');
  if (pretty === '1' || pretty === 'true') return true;

  const accept = req.headers.get('accept') || '';

  // Browser address-bar navigation usually sends text/html.
  // Programmatic clients usually send application/json or */*.
  return accept.includes('text/html');
}

export function humanJson(
  req: NextRequest | Request,
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  const safeBody = sanitizeJsonBody(body);

  if (!wantsPrettyJson(req)) {
    return NextResponse.json(safeBody, init);
  }

  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');

  return new NextResponse(JSON.stringify(safeBody, null, 2), {
    ...init,
    headers,
  });
}
