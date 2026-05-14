import { randomBytes, randomUUID } from 'crypto';
import type { X402Requirement, X402Store } from './types';
import { supabaseStore } from './store.supabase';
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  DEFAULT_REQUIREMENT_TTL_SECONDS,
  JOB_ESCROW_ADDRESS,
  USDC_ADDRESS,
} from './constants';
import { canonicalResource } from './parser';

export interface BuildRequirementInput {
  resource: string;
  resourceMethod?: string;
  agentId?: string;
  jobId?: string;
  amountRequired: string;
  payTo?: `0x${string}`;
  asset?: `0x${string}`;
  description?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  routePattern?: string;
  ttlSeconds?: number;
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

function nonce(): string {
  return `nonce_${randomUUID().replace(/-/g, '')}`;
}

function ttl(input?: number): number {
  const fromEnv = Number(process.env.X402_REQUIREMENT_TTL_SECONDS || '');
  const value = input ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_REQUIREMENT_TTL_SECONDS);
  return Math.max(1, Math.floor(value));
}

function defaultPayTo(): `0x${string}` {
  const envPayTo = process.env.X402_DEFAULT_PAY_TO;
  if (envPayTo && /^0x[a-fA-F0-9]{40}$/.test(envPayTo)) return envPayTo as `0x${string}`;
  return JOB_ESCROW_ADDRESS;
}

export function buildRequirement(input: BuildRequirementInput): X402Requirement {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttl(input.ttlSeconds) * 1000);

  return {
    requirementId: id('req'),
    protocol: 'x402',
    scheme: 'arc-escrow',
    network: ARC_TESTNET_NETWORK,
    chainId: ARC_TESTNET_CHAIN_ID,
    resource: canonicalResource(input.resource),
    resourceMethod: input.resourceMethod ?? 'POST',
    description: input.description,
    mimeType: input.mimeType,
    payTo: input.payTo ?? defaultPayTo(),
    asset: input.asset ?? USDC_ADDRESS,
    amountRequired: input.amountRequired,
    amountDisplay: input.amountRequired,
    currency: 'USDC',
    maxTimeoutSeconds: ttl(input.ttlSeconds),
    expiresAt: expiresAt.toISOString(),
    nonce: nonce(),
    jobId: input.jobId,
    agentId: input.agentId,
    routePattern: input.routePattern,
    metadata: input.metadata ?? {},
    status: 'active',
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  };
}

export async function issueRequirement(
  input: BuildRequirementInput,
  store?: X402Store
): Promise<X402Requirement> {
  const s = store ?? supabaseStore;
  return s.createRequirement(buildRequirement(input));
}
