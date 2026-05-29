import type { IndexedAgent, IndexedJob } from './indexer';
import { displayAgentLabel, parseAgentSkill, shortAgentId } from './agentName';
import { asString } from './safeShape';

export const MANUAL_CATEGORIES = [
  { key: 'Smart Contract', slug: 'smart-contract', copy: 'Audit, escrow, Solidity, protocol tasks.' },
  { key: 'Frontend', slug: 'frontend', copy: 'UI, wallet, dashboard, x402 integration.' },
  { key: 'Backend', slug: 'backend', copy: 'API, routes, database, server logic.' },
  { key: 'DevOps', slug: 'devops', copy: 'Deploy, infra, Vercel, monitoring.' },
  { key: 'Design', slug: 'design', copy: 'UX, visuals, screens, product polish.' },
  { key: 'Data Research', slug: 'data-research', copy: 'Market, signal, dataset, research tasks.' },
  { key: 'Documentation', slug: 'documentation', copy: 'Guides, README, integration docs.' },
  { key: 'Analysis', slug: 'analysis', copy: 'Threat review, reports, and technical analysis.' },
  { key: 'Other', slug: 'other', copy: 'Custom escrow work.' },
] as const;

export const CATEGORY_KEYS = MANUAL_CATEGORIES.map((c) => c.key);
export type ManualCategory = (typeof CATEGORY_KEYS)[number];

export const DELIVERY_TIMES = ['< 1 hour', '1–6 hours', '24 hours', '2–7 days', 'Custom'] as const;
export const DIFFICULTIES = ['Simple', 'Medium', 'Advanced'] as const;

export const JOB_TEMPLATES = [
  { name: 'Smart contract audit', category: 'Smart Contract', title: 'Audit escrow flow', jobSpec: 'Review approve/fund/settle logic and report issues.', duration: '24 hours', difficulty: 'Advanced' },
  { name: 'Frontend wallet integration', category: 'Frontend', title: 'Fix wallet UI flow', jobSpec: 'Improve wallet connection, loading states, and action clarity.', duration: '1–6 hours', difficulty: 'Medium' },
  { name: 'Backend API task', category: 'Backend', title: 'Secure API route', jobSpec: 'Add auth checks and improve error handling.', duration: '24 hours', difficulty: 'Medium' },
  { name: 'Technical analysis', category: 'Analysis', title: 'Review agent workflow', jobSpec: 'Analyze the workflow, identify risks, and provide recommendations.', duration: '2–7 days', difficulty: 'Advanced' },
  { name: 'Documentation task', category: 'Documentation', title: 'Write integration guide', jobSpec: 'Explain setup, usage, and expected flow.', duration: '1–6 hours', difficulty: 'Simple' },
] as const;

export type ManualJobDisplay = {
  category: ManualCategory;
  title: string;
  description: string;
  duration: string;
  difficulty: string;
  isStructured: boolean;
};

export function categoryFromSlug(slug: string): ManualCategory | null {
  const found = MANUAL_CATEGORIES.find((c) => c.slug === slug.toLowerCase());
  return found ? found.key : null;
}

export function slugFromCategory(category: ManualCategory): string {
  return MANUAL_CATEGORIES.find((c) => c.key === category)?.slug ?? 'other';
}

export function normalizeCategory(value: unknown): ManualCategory {
  const text = asString(value).toLowerCase();
  return CATEGORY_KEYS.find((c) => c.toLowerCase() === text) ?? 'Other';
}

export function inferManualJobCategory(job: IndexedJob, agent?: IndexedAgent | null): ManualCategory {
  const agentMetadataUri = agent ? asString(agent.metadataURI) : '';
  const haystack = [
    asString((job as IndexedJob & { taskDescription?: string; jobSpec?: string }).taskDescription),
    asString((job as IndexedJob & { jobSpec?: string }).jobSpec),
    asString(job.jobSpecHash),
    agentMetadataUri,
    agent ? parseAgentSkill(agentMetadataUri) : '',
    agent ? displayAgentLabel({ agentId: asString(agent.agentId), metadataURI: agentMetadataUri }) : '',
  ].join(' ').toLowerCase();
  if (/security|exploit|threat|pentest|vulnerab|analysis|report/.test(haystack)) return 'Analysis';
  if (/solidity|escrow|contract|audit|protocol/.test(haystack)) return 'Smart Contract';
  if (/frontend|ui|react|next|wallet|dashboard/.test(haystack)) return 'Frontend';
  if (/backend|api|route|database|supabase|server/.test(haystack)) return 'Backend';
  if (/agent|llm|a2a|autonomous|runtime/.test(haystack)) return 'Analysis';
  if (/data|research|market|signal/.test(haystack)) return 'Data Research';
  if (/design|ux|visual/.test(haystack)) return 'Design';
  if (/devops|deploy|vercel|infra|monitor/.test(haystack)) return 'DevOps';
  if (/docs|guide|readme|documentation/.test(haystack)) return 'Documentation';
  return 'Other';
}

export function inferAgentCategory(agent: IndexedAgent): ManualCategory {
  const safeAgentId = asString(agent.agentId);
  const safeDescription = asString(agent.metadataURI);
  const synthetic: IndexedJob = {
    id: '',
    client: '',
    provider: '',
    evaluator: '',
    hook: '',
    expiredAt: '0',
    description: '',
    budget: '0',
    fundedAmount: '0',
    createdAtBlock: '',
    updatedAtBlock: '',
    deliverable: '',
    completionReason: '',
    status: 0,
    statusLabel: 'Open',
    // Legacy aliases
    agentId: safeAgentId,
    worker: '',
    jobSpecHash: safeDescription,
    deliverableURI: '',
    proofMetadataURI: '',
    approved: false,
    createdAt: '',
  };
  return inferManualJobCategory(synthetic, agent);
}

export function getManualJobDisplay(job: IndexedJob, agent?: IndexedAgent | null): ManualJobDisplay {
  const safeJobId = asString(job.id);
  const safeAgentId = asString(job.agentId);
  const safeDescription = asString(job.description);
  const safeJobSpecHash = asString(job.jobSpecHash);
  const raw =
    asString((job as IndexedJob & { taskDescription?: string; jobSpec?: string }).taskDescription) ||
    asString((job as IndexedJob & { jobSpec?: string }).jobSpec) ||
    '';
  if (raw && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Partial<
        Record<'category' | 'title' | 'description' | 'duration' | 'difficulty', string>
      >;
      return {
        category: normalizeCategory(parsed.category),
        title: parsed.title?.trim() || `Manual Job #${safeJobId}`,
        description:
          parsed.description?.trim() ||
          `Escrow job assigned to ${
            agent
              ? displayAgentLabel({ agentId: asString(agent.agentId), metadataURI: asString(agent.metadataURI) })
              : shortAgentId(safeAgentId)
          }`,
        duration: parsed.duration?.trim() || 'Unspecified',
        difficulty: parsed.difficulty?.trim() || 'Unspecified',
        isStructured: true,
      };
    } catch {
      // Legacy indexer rows may only expose jobSpecHash. Keep rendering safe.
    }
  }
  const agentLabel = agent
    ? displayAgentLabel({ agentId: asString(agent.agentId), metadataURI: asString(agent.metadataURI) })
    : shortAgentId(safeAgentId);
  return {
    category: inferManualJobCategory(job, agent),
    title: `Manual Job #${safeJobId}`,
    description: `Escrow job assigned to ${agentLabel}`,
    duration: 'Unspecified',
    difficulty: 'Unspecified',
    isStructured: false,
  };
}
