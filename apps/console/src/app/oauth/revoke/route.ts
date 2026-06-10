import { NextRequest, NextResponse } from 'next/server';
import { readOAuthBody } from '@/lib/oauth/request';
import { revokeRawToken } from '@/lib/oauth/token-store';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) { const body = await readOAuthBody(req); const token = typeof body.token === 'string' ? body.token : ''; if (token) await revokeRawToken(token); return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store' } }); }
