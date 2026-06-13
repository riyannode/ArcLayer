/**
 * Runner Registry store — Supabase CRUD for runner_registry table.
 * Server-only. Uses service_role to bypass RLS.
 */
import 'server-only';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import type {
  RunnerRegistryRow,
  RunnerDispatchLogRow,
  RegisterRunnerInput,
  RunnerStatus,
} from './types';

// ── Runner Registry CRUD ──────────────────────────────────────────────────

/**
 * Register a new runner. Upserts on runner_id conflict.
 * hmacSecret is stored as raw bytes (bytea). NOT encrypted — protected by service_role RLS only.
 * For production: use pgcrypto/KMS or secret reference pattern.
 */
export async function registerRunner(input: RegisterRunnerInput): Promise<RunnerRegistryRow> {
  const supabase = getSupabaseAdmin();

  const row = {
    runner_id: input.runnerId,
    agent_id: input.agentId,
    name: input.name ?? null,
    endpoint: input.endpoint,
    allowed_roles: input.allowedRoles ?? ['provider'],
    default_role: input.defaultRole ?? 'provider',
    status: 'active' as RunnerStatus,
    runtime_kind: input.runtimeKind ?? 'openclaw',
    hmac_secret: Buffer.from(input.hmacSecret, 'utf-8'),
    metadata: input.metadata ?? {},
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('runner_registry')
    .upsert(row, { onConflict: 'runner_id' })
    .select()
    .single();

  if (error) throw new Error(`registerRunner failed: ${error.message}`);
  return data as RunnerRegistryRow;
}

/**
 * Get a runner by runner_id.
 * Returns null if not found.
 */
export async function getRunner(runnerId: string): Promise<RunnerRegistryRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('runner_registry')
    .select()
    .eq('runner_id', runnerId)
    .maybeSingle();

  if (error) throw new Error(`getRunner failed: ${error.message}`);
  return data as RunnerRegistryRow | null;
}

/**
 * Get the HMAC secret for a runner (raw bytes decoded to UTF-8).
 * Returns null if runner not found or no secret stored.
 * Secret is stored as raw bytea — NOT encrypted. Protected by service_role RLS only.
 */
export async function getRunnerSecret(runnerId: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('runner_registry')
    .select('hmac_secret')
    .eq('runner_id', runnerId)
    .maybeSingle();

  if (error) throw new Error(`getRunnerSecret failed: ${error.message}`);
  if (!data?.hmac_secret) return null;

  // hmac_secret is stored as bytea — decode to UTF-8 string
  const buf = Buffer.from(data.hmac_secret as unknown as string, 'base64');
  return buf.toString('utf-8');
}

/**
 * List runners for an agent. Optionally filter by status.
 */
export async function listRunners(
  agentId: string,
  filters?: { status?: RunnerStatus }
): Promise<RunnerRegistryRow[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from('runner_registry')
    .select()
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });

  if (filters?.status) q = q.eq('status', filters.status);

  const { data, error } = await q;
  if (error) throw new Error(`listRunners failed: ${error.message}`);
  return (data ?? []) as RunnerRegistryRow[];
}

/**
 * Find the best runner for a given agent + role.
 * Prefers active runners whose allowed_roles includes the requested role.
 */
export async function findRunnerForTask(
  agentId: string,
  role: string
): Promise<RunnerRegistryRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('runner_registry')
    .select()
    .eq('agent_id', agentId)
    .eq('status', 'active')
    .contains('allowed_roles', [role])
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`findRunnerForTask failed: ${error.message}`);
  return data as RunnerRegistryRow | null;
}

/**
 * Update runner last_seen_at timestamp.
 */
export async function touchRunner(runnerId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from('runner_registry')
    .update({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('runner_id', runnerId);
}

// ── Dispatch Log ──────────────────────────────────────────────────────────

/**
 * Insert a dispatch log record.
 */
export async function insertDispatchLog(
  input: Omit<RunnerDispatchLogRow, 'id' | 'created_at'>
): Promise<RunnerDispatchLogRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('runner_dispatch_log')
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(`insertDispatchLog failed: ${error.message}`);
  return data as RunnerDispatchLogRow;
}

/**
 * List dispatch logs for an agent, newest first.
 */
export async function listDispatchLogs(
  agentId: string,
  limit = 50
): Promise<RunnerDispatchLogRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('runner_dispatch_log')
    .select()
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listDispatchLogs failed: ${error.message}`);
  return (data ?? []) as RunnerDispatchLogRow[];
}
