import { NextResponse } from 'next/server';
import { getJobRail } from '@/lib/x402/rail-enforce';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const jobId = params.id;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(jobId)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_job_id', message: 'Job ID must be 1-128 alphanumeric, dash, or underscore characters.' },
      { status: 400 },
    );
  }

  const rail = await getJobRail(jobId);
  return NextResponse.json({
    ok: true,
    jobId,
    rail,
    locked: rail !== null,
  });
}
