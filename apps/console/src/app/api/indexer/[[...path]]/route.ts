import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_FROM_BLOCK } from '@arclayer/indexer/config';
import { fetchJobEvents } from '@arclayer/indexer/ingest';
import {
  buildAgentDetailProjection,
  buildAgentsProjection,
  buildJobDetailProjection,
  buildJobsProjection,
  buildOverviewProjection,
  buildProofsProjection,
} from '@arclayer/indexer/projections';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseIndexPath(request: NextRequest) {
  const raw = request.nextUrl.pathname.replace(/^\/api\/indexer\/?/, '');
  return raw.split('/').filter(Boolean);
}

export async function GET(request: NextRequest) {
  const segments = parseIndexPath(request);
  const events = await fetchJobEvents(DEFAULT_FROM_BLOCK);

  if (segments.length === 0) {
    return NextResponse.json({
      ok: true,
      endpoints: ['/overview', '/jobs', '/jobs/:id', '/agents', '/agents/:id', '/proofs', '/job-events', '/agent-events'],
      eventCount: events.length,
    });
  }

  if (segments[0] === 'overview') {
    return NextResponse.json(await buildOverviewProjection(events));
  }

  if (segments[0] === 'jobs' && segments.length === 1) {
    return NextResponse.json(await buildJobsProjection());
  }

  if (segments[0] === 'jobs' && segments.length === 2) {
    if (!/^\d+$/.test(segments[1])) {
      return NextResponse.json({ error: 'Invalid job id.' }, { status: 400 });
    }

    const detail = await buildJobDetailProjection(BigInt(segments[1]));
    if (!detail) {
      return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    }

    return NextResponse.json(detail);
  }

  if (segments[0] === 'agents' && segments.length === 1) {
    return NextResponse.json(await buildAgentsProjection());
  }

  if (segments[0] === 'agents' && segments.length === 2) {
    if (!/^\d+$/.test(segments[1])) {
      return NextResponse.json({ error: 'Invalid agent id.' }, { status: 400 });
    }

    const detail = await buildAgentDetailProjection(BigInt(segments[1]));
    if (!detail) {
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    }

    return NextResponse.json(detail);
  }

  if (segments[0] === 'proofs') {
    return NextResponse.json(await buildProofsProjection());
  }

  if (segments[0] === 'job-events') {
    return NextResponse.json(events);
  }

  if (segments[0] === 'agent-events') {
    return NextResponse.json(events);
  }

  return NextResponse.json({ error: 'Not found.' }, { status: 404 });
}
