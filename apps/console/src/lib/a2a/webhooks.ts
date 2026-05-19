import { createHmac, randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

const WEBHOOKS_TABLE = 'a2a_webhooks';
const DELIVERIES_TABLE = 'a2a_webhook_deliveries';

export type WebhookEvent =
  | 'job.created'
  | 'job.claimed'
  | 'job.submitted';

export type WebhookSubscription = {
  id: string;
  agentId: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
};

// ─── HMAC Signing ────────────────────────────────────────────────────────────

/**
 * Sign a payload with HMAC-SHA256.
 * Header: X-ArcLayer-Signature: sha256=<hex>
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify an incoming webhook signature.
 */
export function verifySignature(payload: string, secret: string, signature: string): boolean {
  const expected = signPayload(payload, secret);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Subscription CRUD ───────────────────────────────────────────────────────

export async function createWebhook(input: {
  agentId: string;
  url: string;
  events?: WebhookEvent[];
}): Promise<{ ok: true; webhook: WebhookSubscription; secret: string } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin();
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;

  const { data, error } = await supabase
    .from(WEBHOOKS_TABLE)
    .insert({
      agent_id: input.agentId,
      url: input.url,
      secret,
      events: input.events ?? ['job.created', 'job.claimed', 'job.submitted'],
      active: true,
    })
    .select()
    .single();

  if (error) {
    console.error('[webhooks] create error:', error.message);
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    webhook: rowToWebhook(data),
    secret, // shown once
  };
}

export async function listWebhooks(agentId: string): Promise<WebhookSubscription[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(WEBHOOKS_TABLE)
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[webhooks] list error:', error.message);
    return [];
  }
  return (data ?? []).map(rowToWebhook);
}

export async function deleteWebhook(id: string, agentId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from(WEBHOOKS_TABLE)
    .delete()
    .eq('id', id)
    .eq('agent_id', agentId);

  return !error;
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5_000, 30_000, 120_000]; // 5s, 30s, 2min

/**
 * Dispatch a webhook event to all matching subscribers.
 * Fire-and-forget — errors are logged and retried asynchronously.
 */
export async function dispatchWebhookEvent(
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Find all active webhooks subscribed to this event
  const { data: hooks, error } = await supabase
    .from(WEBHOOKS_TABLE)
    .select('*')
    .eq('active', true)
    .contains('events', [event]);

  if (error || !hooks || hooks.length === 0) return;

  // Dispatch to each subscriber
  const deliveries = hooks.map((hook) =>
    deliverWebhook(hook, event, payload),
  );

  await Promise.allSettled(deliveries);
}

async function deliverWebhook(
  hook: Record<string, unknown>,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  attempt = 1,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const url = hook.url as string;
  const secret = hook.secret as string;
  const hookId = hook.id as string;

  const body = JSON.stringify({
    event,
    payload,
    timestamp: new Date().toISOString(),
    webhookId: hookId,
  });

  const signature = signPayload(body, secret);

  // Create delivery record on first attempt
  let deliveryId: string | null = null;
  if (attempt === 1) {
    const { data } = await supabase
      .from(DELIVERIES_TABLE)
      .insert({
        webhook_id: hookId,
        event,
        payload,
        status: 'pending',
        attempts: 0,
      })
      .select('id')
      .single();
    deliveryId = data?.id ?? null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ArcLayer-Event': event,
        'X-ArcLayer-Signature': `sha256=${signature}`,
        'X-ArcLayer-Delivery': deliveryId ?? 'unknown',
        'User-Agent': 'ArcLayer-Webhooks/1.0',
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Update delivery record
    if (deliveryId) {
      await supabase
        .from(DELIVERIES_TABLE)
        .update({
          status: res.ok ? 'delivered' : 'failed',
          attempts: attempt,
          last_attempt_at: new Date().toISOString(),
          response_status: res.status,
          response_body: (await res.text().catch(() => '')).slice(0, 500),
        })
        .eq('id', deliveryId);
    }

    // Retry on 5xx
    if (!res.ok && res.status >= 500 && attempt < MAX_RETRIES) {
      scheduleRetry(hook, event, payload, attempt + 1, deliveryId);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[webhooks] delivery failed (attempt ${attempt}):`, msg);

    if (deliveryId) {
      await supabase
        .from(DELIVERIES_TABLE)
        .update({
          status: attempt >= MAX_RETRIES ? 'failed' : 'retrying',
          attempts: attempt,
          last_attempt_at: new Date().toISOString(),
          response_body: msg.slice(0, 500),
        })
        .eq('id', deliveryId);
    }

    if (attempt < MAX_RETRIES) {
      scheduleRetry(hook, event, payload, attempt + 1, deliveryId);
    }
  }
}

function scheduleRetry(
  hook: Record<string, unknown>,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  attempt: number,
  _deliveryId: string | null,
): void {
  const delay = RETRY_DELAYS[attempt - 2] ?? 120_000;
  setTimeout(() => {
    deliverWebhook(hook, event, payload, attempt).catch(() => {});
  }, delay);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToWebhook(row: Record<string, unknown>): WebhookSubscription {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    url: row.url as string,
    events: row.events as WebhookEvent[],
    active: row.active as boolean,
    createdAt: row.created_at as string,
  };
}
