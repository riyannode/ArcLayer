/**
 * Rail Session Guard — locks a payment session to a single rail.
 *
 * Prevents cross-rail attacks where an attacker uses EOA header on a
 * Gateway-only session or vice versa.
 *
 * Storage: in-memory Map with TTL expiry (stateless across deploys, but
 * sufficient for testnet). Production would use Redis/Supabase.
 */

import { randomBytes } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AllowedRail = 'arc-native-eoa' | 'circle-gateway-passkey';

export interface RailSession {
  sessionId: string;
  resource: string;
  payer: string;
  allowedRail: AllowedRail;
  amount: string;
  status: 'pending' | 'consumed' | 'expired';
  createdAt: number;
  expiresAt: number;
}

// ─── Store ────────────────────────────────────────────────────────────────────

const sessions = new Map<string, RailSession>();

// Cleanup expired sessions every 60s
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const id of Array.from(sessions.keys())) {
      const s = sessions.get(id);
      if (s && s.expiresAt < now) sessions.delete(id);
    }
  }, 60_000);
}

// ─── API ──────────────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Create a rail session. Returns sessionId to embed in 402 response.
 */
export function createRailSession(opts: {
  resource: string;
  payer: string;
  allowedRail: AllowedRail;
  amount: string;
  ttlMs?: number;
}): RailSession {
  const sessionId = `rail_sess_${randomBytes(16).toString('hex')}`;
  const now = Date.now();
  const session: RailSession = {
    sessionId,
    resource: opts.resource,
    payer: opts.payer.toLowerCase(),
    allowedRail: opts.allowedRail,
    amount: opts.amount,
    status: 'pending',
    createdAt: now,
    expiresAt: now + (opts.ttlMs ?? SESSION_TTL_MS),
  };
  sessions.set(sessionId, session);
  return session;
}

/**
 * Validate an incoming payment against its rail session.
 * Returns { ok: true } or { ok: false, error, message }.
 */
export function validateRailSession(opts: {
  sessionId: string;
  incomingRail: AllowedRail;
  payer: string;
  resource: string;
  amount: string;
}): { ok: true } | { ok: false; error: string; message: string } {
  const session = sessions.get(opts.sessionId);

  if (!session) {
    return { ok: false, error: 'rail_session_not_found', message: 'Rail session does not exist or has expired.' };
  }

  if (session.status === 'consumed') {
    return { ok: false, error: 'rail_session_consumed', message: 'This rail session has already been used.' };
  }

  if (session.expiresAt < Date.now()) {
    session.status = 'expired';
    return { ok: false, error: 'rail_session_expired', message: 'Rail session has expired. Request a new 402 challenge.' };
  }

  if (session.allowedRail !== opts.incomingRail) {
    return {
      ok: false,
      error: 'rail_mismatch',
      message: `This session only accepts ${session.allowedRail === 'arc-native-eoa' ? 'Arc Native' : 'Circle Gateway'} payment. Got ${opts.incomingRail === 'arc-native-eoa' ? 'Arc Native' : 'Circle Gateway'}.`,
    };
  }

  if (session.payer !== opts.payer.toLowerCase()) {
    return { ok: false, error: 'rail_payer_mismatch', message: 'Payment payer does not match session payer.' };
  }

  if (session.resource !== opts.resource) {
    return { ok: false, error: 'rail_resource_mismatch', message: 'Payment resource does not match session resource.' };
  }

  if (session.amount !== opts.amount) {
    return { ok: false, error: 'rail_amount_mismatch', message: 'Payment amount does not match session amount.' };
  }

  return { ok: true };
}

/**
 * Mark session as consumed after successful settlement.
 */
export function consumeRailSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'pending') return false;
  session.status = 'consumed';
  return true;
}

/**
 * Get session by ID (for inspection/debugging).
 */
export function getRailSession(sessionId: string): RailSession | null {
  return sessions.get(sessionId) ?? null;
}
