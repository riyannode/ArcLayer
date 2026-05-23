import { NextResponse } from 'next/server';

export function requireA2aAdmin(request: Request): NextResponse | null {
  const token = process.env.A2A_ADMIN_TOKEN?.trim();
  if (!token) return NextResponse.json({ error: 'admin_not_configured' }, { status: 503 });

  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.slice('Bearer '.length).trim() !== token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return null;
}
