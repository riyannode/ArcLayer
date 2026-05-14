import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json(
    {
      error: 'run_store_removed',
      message: 'Local run storage has been removed. Use indexed job deliverables instead.',
      jobId: params.id,
      count: 0,
      runs: [],
    },
    { status: 410 }
  );
}
