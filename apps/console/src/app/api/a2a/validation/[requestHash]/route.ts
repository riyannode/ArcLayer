import { humanJson } from '@/lib/api/human-json';
import { type Hex } from 'viem';
import { getValidationStatus } from '@/lib/a2a/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function publicErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (
    raw.endsWith('_required') ||
    raw.endsWith('_invalid') ||
    raw.includes('_must_be_') ||
    raw.includes('_out_of_') ||
    raw === 'validation_request_not_found' ||
    raw === 'validation_request_not_found_onchain'
  ) {
    return raw;
  }
  return 'internal_error';
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestHash: string }> },
) {
    const { requestHash } = await params;
  try {
    const result = await getValidationStatus(requestHash as Hex);
    return humanJson(_request, result);
  } catch (error) {
    console.error('validation status lookup failed', error);
    const message = publicErrorMessage(error);

    return humanJson(_request, { ok: false, error: message, source: 'erc8004_validation_registry' }, { status: 400 });
  }
}
