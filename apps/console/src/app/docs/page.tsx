import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { MDXRemote } from 'next-mdx-remote/rsc';

const quickstart = [
  'Install the workspace SDK package.',
  'Read contract addresses and ABIs from @arclayer/sdk.',
  'Create jobs or inspect project history using exported helpers.',
  'Use the indexer service for cached protocol reads when RPC fanout becomes expensive.',
];

const sdkExamples = [
  {
    title: 'Read protocol addresses and load a job',
    code: `import { CONTRACTS, readJob } from '@arclayer/sdk';

const job = await readJob(0n);
console.log(CONTRACTS.JOB_ESCROW, job);`,
  },
  {
    title: 'Register and submit with write helpers',
    code: `import { createArcClient, registerAgent, submitDeliverable } from '@arclayer/sdk';

const client = createArcClient({ account, transport });
await registerAgent(client, {
  agentId: 12n,
  skillHash: '0xabc123...',
  metadataURI: 'ipfs://agent-profile',
});

await submitDeliverable(client, {
  jobId: 8n,
  deliverableURI: 'ipfs://deliverable',
  proofMetadataURI: 'ipfs://proof',
});`,
  },
  {
    title: 'Query indexer for agent telemetry',
    code: `const res = await fetch(process.env.NEXT_PUBLIC_INDEXER_URL + '/agents/1');
const profile = await res.json();
console.log(profile.agent.score, profile.jobs.length, profile.proofs.length);`,
  },
];

async function loadBuildPlanMdx() {
  const buildPlanPath = path.join(process.cwd(), '..', '..', 'docs', 'arclayer-build-plan.md');
  return fs.readFile(buildPlanPath, 'utf8');
}

export default async function DocsPage() {
  const buildPlan = await loadBuildPlanMdx();

  return (
    <div className="relative px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/70">Developer docs</p>
        <h1 className="font-[var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] md:text-[52px]">ArcLayer SDK quickstart</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-white/50">
          The repo exposes a workspace SDK, a standalone indexer package, and a console app. This page keeps the quickstart
          and build plan in one place.
        </p>

        <div className="mt-8 grid gap-3">
          {quickstart.map((item, index) => (
            <div key={item} className="rounded-lg border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-white/35">Step {index + 1}</p>
              <p className="mt-2 text-sm text-white/70">{item}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 space-y-4">
          {sdkExamples.map((example) => (
            <div key={example.title} className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
              <p className="text-sm font-semibold text-cyan-100">{example.title}</p>
              <pre className="mt-3 overflow-x-auto text-sm text-cyan-100">{example.code}</pre>
            </div>
          ))}
        </div>

        <section className="prose prose-invert mt-10 max-w-none rounded-xl border border-white/10 bg-black/20 p-6 prose-pre:bg-black/40 prose-pre:text-cyan-100 prose-code:text-cyan-200">
          <MDXRemote source={buildPlan} />
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard" className="btn-primary">Open console</Link>
          <Link href="/job/0" className="rounded-md border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:border-cyan-300/30 hover:text-cyan-200">Inspect sample job</Link>
        </div>
      </div>
    </div>
  );
}
