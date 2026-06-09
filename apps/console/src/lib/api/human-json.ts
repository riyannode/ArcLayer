import { NextRequest, NextResponse } from 'next/server';

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
  if (!wantsPrettyJson(req)) {
    return NextResponse.json(body, init);
  }

  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');

  return new NextResponse(JSON.stringify(body, null, 2), {
    ...init,
    headers,
  });
}
