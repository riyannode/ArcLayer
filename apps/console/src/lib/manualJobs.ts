import type { IndexedAgent, IndexedJob } from './indexer';
import { displayAgentLabel, parseAgentSkill, shortAgentId } from './agentName';

export const MANUAL_CATEGORIES = [
  { key: 'Smart Contract', slug: 'smart-contract', copy: 'Audit, escrow, Solidity, protocol tasks.' },
  { key: 'Frontend', slug: 'frontend', copy: 'UI, wallet, dashboard, x402 integration.' },
  { key: 'Backend', slug: 'backend', copy: 'API, routes, database, server logic.' },
  { key: 'AI Agent', slug: 'ai-agent', copy: 'LLM runtime, agent setup, A2A workflow.' },
  { key: 'Security Audit', slug: 'security-audit', copy: 'Threat review, exploits, risk reports.' },
  { key: 'Data / Research', slug: 'data-research', copy: 'Market, signal, dataset, research tasks.' },
  { key: 'Design / UI', slug: 'design-ui', copy: 'UX, visuals, screens, product polish.' },
  { key: 'DevOps', slug: 'devops', copy: 'Deploy, infra, Vercel, monitoring.' },
  { key: 'Documentation', slug: 'documentation', copy: 'Guides, README, integration docs.' },
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
  { name: 'AI agent setup', category: 'AI Agent', title: 'Connect external agent runtime', jobSpec: 'Configure an agent endpoint and test job execution.', duration: '2–7 days', difficulty: 'Advanced' },
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
  const text = String(value ?? '').trim().toLowerCase();
  return CATEGORY_KEYS.find((c) => c.toLowerCase() === text) ?? 'Other';
}

export function inferManualJobCategory(job: IndexedJob, agent?: IndexedAgent | null): ManualCategory {
  const haystack = [
    (job as IndexedJob & { taskDescription?: string; jobSpec?: string }).taskDescription,
    (job as IndexedJob & { jobSpec?: string }).jobSpec,
    job.jobSpecHash,
    agent?.metadataURI,
    agent ? parseAgentSkill(agent.metadataURI) : '',
    agent ? displayAgentLabel({ agentId: agent.agentId, metadataURI: agent.metadataURI }) : '',
  ].join(' ').toLowerCase();
  if (/security|exploit|threat|pentest|vulnerab/.test(haystack)) return 'Security Audit';
  if (/solidity|escrow|contract|audit|protocol/.test(haystack)) return 'Smart Contract';
  if (/frontend|ui|react|next|wallet|dashboard/.test(haystack)) return 'Frontend';
  if (/backend|api|route|database|supabase|server/.test(haystack)) return 'Backend';
  if (/agent|llm|a2a|autonomous|runtime/.test(haystack)) return 'AI Agent';
  if (/data|research|market|signal/.test(haystack)) return 'Data / Research';
  if (/design|ux|visual/.test(haystack)) return 'Design / UI';
  if (/devops|deploy|vercel|infra|monitor/.test(haystack)) return 'DevOps';
  if (/docs|guide|readme|documentation/.test(haystack)) return 'Documentation';
  return 'Other';
}

export function inferAgentCategory(agent: IndexedAgent): ManualCategory {
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
    statusLabel: 'Created',
    // Legacy aliases
    agentId: agent.agentId,
    worker: '',
    jobSpecHash: '',
    deliverableURI: '',
    proofMetadataURI: '',
    approved: false,
    createdAt: '',
  };
  return inferManualJobCategory(synthetic, agent);
}

export function getManualJobDisplay(job: IndexedJob, agent?: IndexedAgent | null): ManualJobDisplay {
  const raw =
    (job as IndexedJob & { taskDescription?: string; jobSpec?: string }).taskDescription ??
    (job as IndexedJob & { jobSpec?: string }).jobSpec ??
    '';
  if (raw && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Partial<
        Record<'category' | 'title' | 'description' | 'duration' | 'difficulty', string>
      >;
      return {
        category: normalizeCategory(parsed.category),
        title: parsed.title?.trim() || `Manual Job #${job.id}`,
        description:
          parsed.description?.trim() ||
          `Escrow job assigned to ${
            agent
              ? displayAgentLabel({ agentId: agent.agentId, metadataURI: agent.metadataURI })
              : shortAgentId(job.agentId)
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
    ? displayAgentLabel({ agentId: agent.agentId, metadataURI: agent.metadataURI })
    : shortAgentId(job.agentId);
  return {
    category: inferManualJobCategory(job, agent),
    title: `Manual Job #${job.id}`,
    description: `Escrow job assigned to ${agentLabel}`,
    duration: 'Unspecified',
    difficulty: 'Unspecified',
    isStructured: false,
  };
}
