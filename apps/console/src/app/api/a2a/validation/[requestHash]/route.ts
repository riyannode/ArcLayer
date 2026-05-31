import { NextResponse } from 'next/server';
import { type Hex } from 'viem';
import { getValidationStatus } from '@/lib/a2a/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: { requestHash: string } },
) {
  try {
    const result = await getValidationStatus(params.requestHash as Hex);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return NextResponse.json(
      { ok: false, error: message, source: 'erc8004_validation_registry' },
      { status: 400 },
    );
  }
}
