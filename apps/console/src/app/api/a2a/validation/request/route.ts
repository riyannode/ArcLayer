import { NextResponse } from 'next/server';
import {
  createValidationRequest,
  type ValidationRequestInput,
} from '@/lib/a2a/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requireAdmin(request: Request) {
  const expected = process.env.VALIDATION_API_KEY;
  if (!expected) throw new Error('missing_VALIDATION_API_KEY');

  const received =
    request.headers.get('x-arclayer-admin-key') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (received !== expected) throw new Error('unauthorized');
}

function statusFor(message: string) {
  if (message === 'unauthorized') return 401;
  if (message === 'missing_VALIDATION_API_KEY') return 503;
  if (message.startsWith('missing_or_invalid_')) return 503;
  if (message.startsWith('db_')) return 500;
  if (message.includes('must_match')) return 409;
  if (message.endsWith('_required')) return 400;
  if (message.endsWith('_invalid')) return 400;
  if (message.includes('_must_be_')) return 400;
  return 500;
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);

    const body = (await request.json()) as ValidationRequestInput;
    const result = await createValidationRequest(body);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return NextResponse.json(
      { ok: false, error: message, source: 'erc8004_validation_registry' },
      { status: statusFor(message) },
    );
  }
}
