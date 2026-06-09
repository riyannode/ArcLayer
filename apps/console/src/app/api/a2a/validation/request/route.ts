import { humanJson } from '@/lib/api/human-json';
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
  if (message === 'validation_request_already_pending') return 409;
  if (message.includes('must_match')) return 409;
  if (message.endsWith('_required')) return 400;
  if (message.endsWith('_invalid')) return 400;
  if (message.includes('_must_be_')) return 400;
  return 500;
}

function publicErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (
    raw === 'unauthorized' ||
    raw === 'missing_VALIDATION_API_KEY' ||
    raw === 'validation_request_already_pending' ||
    raw.startsWith('missing_or_invalid_') ||
    raw.startsWith('db_') ||
    raw.includes('must_match') ||
    raw.endsWith('_required') ||
    raw.endsWith('_invalid') ||
    raw.includes('_must_be_')
  ) {
    return raw;
  }
  return 'internal_error';
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);

    const body = (await request.json()) as ValidationRequestInput;
    const result = await createValidationRequest(body);

    return humanJson(request, result);
  } catch (error) {
    console.error('validation request failed', error);
    const message = publicErrorMessage(error);

    return humanJson(request, { ok: false, error: message, source: 'erc8004_validation_registry' }, { status: statusFor(message) });
  }
}
