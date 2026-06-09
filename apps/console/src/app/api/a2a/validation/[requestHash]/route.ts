import { humanJson } from '@/lib/api/human-json';
import { type Hex } from 'viem';
import { getValidationStatus } from '@/lib/a2a/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    return humanJson(_request, { ok: false, error: 'internal_error', source: 'erc8004_validation_registry' }, { status: 400 });
  }
}
