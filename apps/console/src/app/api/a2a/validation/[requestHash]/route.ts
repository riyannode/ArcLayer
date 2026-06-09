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
    const message = error instanceof Error ? error.message : String(error);
    const isClientError = message.endsWith('_required') || message.endsWith('_invalid');
    const publicMessage = isClientError ? message : 'internal_error';

    console.error('validation/[requestHash] failed', error);

    return humanJson(_request, { ok: false, error: publicMessage, source: 'erc8004_validation_registry' }, { status: 400 });
  }
}
