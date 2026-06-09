import { humanJson } from '@/lib/api/human-json';
import {
  createValidationResponse,
  type ValidationResponseInput,
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

  if (
    message === 'validation_request_not_found' ||
    message === 'validation_request_not_found_onchain' ||
    message === 'validation_already_responded_onchain' ||
    message === 'validation_response_signer_mismatch_db' ||
    message === 'validation_response_signer_mismatch_onchain' ||
    message === 'validation_response_already_pending'
  ) {
    return 409;
  }

  if (message.endsWith('_required')) return 400;
  if (message.endsWith('_invalid')) return 400;
  if (message.includes('_must_be_')) return 400;
  if (message.includes('_out_of_')) return 400;
  return 500;
}

function publicErrorMessage(message: string): string {
  const status = statusFor(message);
  if (status < 500) return message;
  return 'internal_error';
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);

    const body = (await request.json()) as ValidationResponseInput;
    const result = await createValidationResponse(body);

    return humanJson(request, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = statusFor(message);
    const publicMessage = publicErrorMessage(message);

    console.error('validation/response failed', error);

    return humanJson(request, { ok: false, error: publicMessage, source: 'erc8004_validation_registry' }, { status });
  }
}
