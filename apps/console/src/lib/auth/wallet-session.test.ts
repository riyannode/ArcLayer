/**
 * Tests for lib/auth/wallet-session.ts (Supabase-backed)
 *
 * Uses createTestSupabaseMock() to inject in-memory Supabase mock.
 * Covers: HMAC token signing, nonce hash storage, nonce consumption,
 * wallet mismatch, expired nonce, session create/resolve/revoke, linked agents.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateNonce,
  buildNonceSignMessage,
  buildSessionCookie,
  buildClearSessionCookie,
  verifySessionToken,
  resolveSessionFromCookie,
  destroySession,
  verifyAndCreateSession,
  createTestSupabaseMock,
  SESSION_COOKIE_NAME,
  type VerifyError,
} from './wallet-session';

// ── Mock viem verifyMessage ───────────────────────────────────────────────

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    verifyMessage: vi.fn().mockResolvedValue(true),
  };
});

// ── Mock Supabase client ──────────────────────────────────────────────────

let mockSupabase: ReturnType<typeof createTestSupabaseMock>;

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => mockSupabase.supabase,
}));

// ── Constants ─────────────────────────────────────────────────────────────

const VALID_WALLET = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
const MOCK_SIG = `0x${'ab'.repeat(65)}`;

// ── Tests ─────────────────────────────────────────────────────────────────

describe('wallet-session (Supabase-backed)', () => {
  beforeEach(() => {
    mockSupabase = createTestSupabaseMock();
  });

  // ── HMAC token round-trip ──────────────────────────────────────────────

  describe('HMAC session token', () => {
    it('rejects empty string', () => {
      expect(verifySessionToken('')).toBeNull();
    });

    it('rejects token without dot separator', () => {
      expect(verifySessionToken('nodosot')).toBeNull();
    });

    it('rejects tampered signature', () => {
      expect(verifySessionToken('abc123.abcdef0000')).toBeNull();
    });
  });

  // ── Nonce: hash stored, not raw ────────────────────────────────────────

  describe('generateNonce', () => {
    it('rejects invalid address', async () => {
      const result = await generateNonce('not-an-address');
      expect(result.ok).toBe(false);
      expect((result as VerifyError).error).toBe('invalid_address');
    });

    it('stores nonce_hash in DB, not raw nonce', async () => {
      const result = await generateNonce(VALID_WALLET);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // DB should have one nonce row
      expect(mockSupabase.nonceRows).toHaveLength(1);
      const row = mockSupabase.nonceRows[0] as Record<string, unknown>;

      // nonce_hash should be sha256 of raw nonce
      const { createHash } = await import('node:crypto');
      const expectedHash = createHash('sha256').update(result.nonce).digest('hex');
      expect(row.nonce_hash).toBe(expectedHash);

      // Raw nonce should NOT be stored
      expect(row).not.toHaveProperty('nonce');
    });

    it('returns correct message with wallet and nonce', async () => {
      const result = await generateNonce(VALID_WALLET);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.address).toBe(VALID_WALLET);
      expect(result.message).toContain('ArcLayer Wallet Session');
      expect(result.message).toContain(VALID_WALLET);
      expect(result.message).toContain(result.nonce);
    });

    it('lowercase address is checksummed', async () => {
      const result = await generateNonce('0xf5f11e68fbcbfa20de9208709ab60ff81509cb20');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.address).toBe(VALID_WALLET);
    });
  });

  // ── Nonce verify: consumes nonce ───────────────────────────────────────

  describe('verifyAndCreateSession', () => {
    it('rejects invalid wallet', async () => {
      const nonceResult = await generateNonce(VALID_WALLET);
      expect(nonceResult.ok).toBe(true);
      if (!nonceResult.ok) return;

      const result = await verifyAndCreateSession({
        wallet: 'not-an-address',
        nonce: nonceResult.nonce,
        signature: MOCK_SIG,
      });
      expect(result.ok).toBe(false);
      expect((result as VerifyError).error).toBe('invalid_wallet');
    });

    it('rejects wallet mismatch with nonce-bound controller', async () => {
      const otherWallet = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      const nonceResult = await generateNonce(VALID_WALLET);
      expect(nonceResult.ok).toBe(true);
      if (!nonceResult.ok) return;

      const result = await verifyAndCreateSession({
        wallet: otherWallet,
        nonce: nonceResult.nonce,
        signature: MOCK_SIG,
      });
      expect(result.ok).toBe(false);
      expect((result as VerifyError).error).toBe('wallet_mismatch');
    });

    it('rejects unknown nonce', async () => {
      const result = await verifyAndCreateSession({
        wallet: VALID_WALLET,
        nonce: 'deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000',
        signature: MOCK_SIG,
      });
      expect(result.ok).toBe(false);
      expect((result as VerifyError).error).toBe('nonce_not_found');
    });

    it('rejects reused nonce (replay protection)', async () => {
      const nonceResult = await generateNonce(VALID_WALLET);
      expect(nonceResult.ok).toBe(true);
      if (!nonceResult.ok) return;

      const first = await verifyAndCreateSession({
        wallet: VALID_WALLET,
        nonce: nonceResult.nonce,
        signature: MOCK_SIG,
      });
      expect(first.ok).toBe(true);

      // Second attempt — nonce already used
      const second = await verifyAndCreateSession({
        wallet: VALID_WALLET,
        nonce: nonceResult.nonce,
        signature: MOCK_SIG,
      });
      expect(second.ok).toBe(false);
      expect((second as VerifyError).error).toBe('nonce_used');
    });

    it('rejects expired nonce', async () => {
      // Generate nonce then manually expire it
      const nonceResult = await generateNonce(VALID_WALLET);
      expect(nonceResult.ok).toBe(true);
      if (!nonceResult.ok) return;

      // Expire the nonce in the mock DB
      const row = mockSupabase.nonceRows[0] as Record<string, unknown>;
      row.expires_at = new Date(Date.now() - 1000).toISOString();

      const result = await verifyAndCreateSession({
        wallet: VALID_WALLET,
        nonce: nonceResult.nonce,
        signature: MOCK_SIG,
      });
      expect(result.ok).toBe(false);
      expect((result as VerifyError).error).toBe('nonce_expired');
    });

    it('creates session row and returns cookie token on success', async () => {
      const nonceResult = await generateNonce(VALID_WALLET);
      expect(nonceResult.ok).toBe(true);
      if (!nonceResult.ok) return;

      const result = await verifyAndCreateSession({
        wallet: VALID_WALLET,
        nonce: nonceResult.nonce,
        signature: MOCK_SIG,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Session row created
      expect(mockSupabase.sessionRows).toHaveLength(1);
      const sessionRow = mockSupabase.sessionRows[0] as Record<string, unknown>;
      expect(sessionRow.controller).toBe(VALID_WALLET.toLowerCase());
      expect(sessionRow.revoked_at ?? null).toBeNull();

      // Cookie token present
      expect(result.cookieToken).toBeDefined();
      expect(result.session.wallet).toBe(VALID_WALLET.toLowerCase());
    });

    it('nonce row marked as used after successful verify', async () => {
      const nonceResult = await generateNonce(VALID_WALLET);
      expect(nonceResult.ok).toBe(true);
      if (!nonceResult.ok) return;

      await verifyAndCreateSession({
        wallet: VALID_WALLET,
        nonce: nonceResult.nonce,
        signature: MOCK_SIG,
      });

      const nonceRow = mockSupabase.nonceRows[0] as Record<string, unknown>;
      expect(nonceRow.used_at).toBeTruthy();
    });
  });

  // ── Session resolve from cookie ────────────────────────────────────────

  describe('resolveSessionFromCookie', () => {
    it('returns null for garbage cookie', async () => {
      expect(await resolveSessionFromCookie('garbage')).toBeNull();
    });

    it('returns null for empty string', async () => {
      expect(await resolveSessionFromCookie('')).toBeNull();
    });

    it('resolves valid session from cookie', async () => {
      const nonceResult = await generateNonce(VALID_WALLET);
      expect(nonceResult.ok).toBe(true);
      if (!nonceResult.ok) return;

      const createResult = await verifyAndCreateSession({
        wallet: VALID_WALLET,
        nonce: nonceResult.nonce,
        signature: MOCK_SIG,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok || !createResult.cookieToken) return;

      const resolved = await resolveSessionFromCookie(createResult.cookieToken);
      expect(resolved).not.toBeNull();
      expect(resolved!.wallet).toBe(VALID_WALLET.toLowerCase());
    });

    it('returns null for expired session', async () => {
      const nonceResult = await generateNonce(VALID_WALLET);
      expect(nonceResult.ok).toBe(true);
      if (!nonceResult.ok) return;

      const createResult = await verifyAndCreateSession({
        wallet: VALID_WALLET,
        nonce: nonceResult.nonce,
        signature: MOCK_SIG,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok || !createResult.cookieToken) return;

      // Expire the session
      const sessionRow = mockSupabase.sessionRows[0] as Record<string, unknown>;
      sessionRow.expires_at = new Date(Date.now() - 1000).toISOString();

      const resolved = await resolveSessionFromCookie(createResult.cookieToken);
      expect(resolved).toBeNull();
    });

    it('returns null for revoked session', async () => {
      const nonceResult = await generateNonce(VALID_WALLET);
      expect(nonceResult.ok).toBe(true);
      if (!nonceResult.ok) return;

      const createResult = await verifyAndCreateSession({
        wallet: VALID_WALLET,
        nonce: nonceResult.nonce,
        signature: MOCK_SIG,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok || !createResult.cookieToken) return;

      // Revoke the session
      const sessionRow = mockSupabase.sessionRows[0] as Record<string, unknown>;
      sessionRow.revoked_at = new Date().toISOString();

      const resolved = await resolveSessionFromCookie(createResult.cookieToken);
      expect(resolved).toBeNull();
    });
  });

  // ── Logout: revokes session ────────────────────────────────────────────

  describe('destroySession (logout)', () => {
    it('revokes session in DB', async () => {
      const nonceResult = await generateNonce(VALID_WALLET);
      expect(nonceResult.ok).toBe(true);
      if (!nonceResult.ok) return;

      const createResult = await verifyAndCreateSession({
        wallet: VALID_WALLET,
        nonce: nonceResult.nonce,
        signature: MOCK_SIG,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok || !createResult.cookieToken) return;

      const destroyed = await destroySession(createResult.cookieToken);
      expect(destroyed).toBe(true);

      // Session row should have revoked_at
      const sessionRow = mockSupabase.sessionRows[0] as Record<string, unknown>;
      expect(sessionRow.revoked_at).toBeTruthy();

      // Subsequent resolve should fail
      const resolved = await resolveSessionFromCookie(createResult.cookieToken);
      expect(resolved).toBeNull();
    });

    it('returns false for non-existent session', async () => {
      expect(await destroySession('nonexistent.sig')).toBe(false);
    });
  });

  // ── Cookie helpers ─────────────────────────────────────────────────────

  describe('cookie helpers', () => {
    it('buildSessionCookie includes required attributes', () => {
      const cookie = buildSessionCookie('test-token');
      expect(cookie).toContain(`${SESSION_COOKIE_NAME}=test-token`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Max-Age=');
    });

    it('buildClearSessionCookie sets Max-Age=0', () => {
      const cookie = buildClearSessionCookie();
      expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('HttpOnly');
    });
  });

  // ── buildNonceSignMessage ──────────────────────────────────────────────

  describe('buildNonceSignMessage', () => {
    it('includes wallet and nonce', () => {
      const msg = buildNonceSignMessage(VALID_WALLET, 'abc123');
      expect(msg).toContain('ArcLayer Wallet Session');
      expect(msg).toContain(VALID_WALLET);
      expect(msg).toContain('abc123');
    });

    it('checksums the wallet address', () => {
      const msg = buildNonceSignMessage('0xf5f11e68fbcbfa20de9208709ab60ff81509cb20', 'x');
      expect(msg).toContain(VALID_WALLET);
    });
  });
});
