import { NextResponse } from 'next/server';

export function requireA2AAdmin(request: Request): NextResponse | null {
  const token = process.env.A2A_ADMIN_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: 'admin_not_configured' }, { status: 503 });
  }

  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!bearer || bearer !== token) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  return null;
}
