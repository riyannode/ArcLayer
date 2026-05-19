import { z } from 'zod';

export const createJobSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z.string().max(100).optional(),
  roleId: z.string().max(100).optional(),
  budget: z.string().max(50).optional(),
  requester: z.string().max(200).optional(),
  agentId: z.string().max(200).optional(),
  input: z.unknown().optional(),
});

export const claimJobSchema = z.object({
  agentId: z.string().min(1).max(200),
});

export const submitJobSchema = z.object({
  agentId: z.string().min(1).max(200),
  output: z.unknown().optional(),
  proof: z.unknown().optional(),
  summary: z.string().max(10000).optional(),
});

export const createWebhookSchema = z.object({
  url: z.string().url().startsWith('https://'),
  events: z.array(z.enum(['job.created', 'job.claimed', 'job.submitted'])).optional(),
});

export const createApiKeySchema = z.object({
  agentId: z.string().min(1).max(200),
  label: z.string().max(100).optional(),
  scopes: z.array(z.string().max(50)).optional(),
});
