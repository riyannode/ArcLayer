import { NextRequest, NextResponse } from 'next/server';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json(
    {
      error: 'run_store_removed',
      message: 'Manual submit retry depended on local run storage, which has been removed. Re-run the paid agent flow or submit through the job page.',
      jobId: params.id,
    },
    { status: 410 }
  );
}
