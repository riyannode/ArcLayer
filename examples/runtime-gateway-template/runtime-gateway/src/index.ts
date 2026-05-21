import { createServer } from 'node:http';
import { URL } from 'node:url';
import { buildManifest } from './manifest.js';
import { runJob } from './job-runner.js';

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

async function readJson(req: import('node:http').IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const jobs = new Map<string, unknown>();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const manifest = buildManifest();

    if (req.method === 'GET' && (url.pathname === '/manifest' || url.pathname === '/.well-known/arclayer-agent.json')) {
      return json(res, 200, manifest);
    }

    if (req.method === 'POST' && url.pathname === '/jobs/claim') {
      const body = await readJson(req);
      const jobId = body.jobId ?? `local_${Date.now()}`;
      jobs.set(jobId, { ...body, status: 'claimed', claimedAt: new Date().toISOString() });
      return json(res, 200, { ok: true, jobId, agentId: manifest.agentId, status: 'claimed' });
    }

    if (req.method === 'POST' && url.pathname === '/jobs/run') {
      const body = await readJson(req);
      const job = { id: body.id ?? body.jobId ?? `local_${Date.now()}`, ...body };
      const result = await runJob(job);
      jobs.set(job.id, { ...job, status: 'completed', result });
      return json(res, 200, { ok: true, jobId: job.id, agentId: manifest.agentId, ...result });
    }

    const statusMatch = url.pathname.match(/^\/jobs\/status\/([^/]+)$/);
    if (req.method === 'GET' && statusMatch) {
      const jobId = statusMatch[1];
      return json(res, jobs.has(jobId) ? 200 : 404, jobs.get(jobId) ?? { ok: false, error: 'job_not_found', jobId });
    }

    return json(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    return json(res, 500, { ok: false, error: err instanceof Error ? err.message : 'internal_error' });
  }
});

const port = Number(process.env.PORT ?? 8788);
server.listen(port, () => {
  console.log(`ArcLayer runtime gateway listening on http://localhost:${port}`);
});
