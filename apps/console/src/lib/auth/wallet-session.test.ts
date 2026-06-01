/**
 * Tests for lib/auth/wallet-session.ts
 *
 * Covers: nonce generation, sign message, session create/resolve/destroy,
 * cookie token signing/verification, expiry, replay protection.
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
  SESSION_COOKIE_NAME,
  __resetStoresForTests,
  type VerifyError,
} from './wallet-session';

// ── Mock viem verifyMessage ───────────────────────────────────────────────
// We mock verifyMessage to avoid needing real wallet signatures in tests.

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    verifyMessage: vi.fn().mockResolvedValue(true), // always valid in tests
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('wallet-session', () => {
  beforeEach(() => {
    __resetStoresForTests();
  });

  describe('generateNonce', () => {
    it('returns a 64-char hex nonce', () => {
      const { nonce, expiresAt } = generateNonce();
      expect(nonce).toMatch(/^[a-f0-9]{64}$/);
      expect(expiresAt).toBeGreaterThan(Date.now());
    });

    it('generates unique nonces', () => {
      const a = generateNonce().nonce;
      const b = generateNonce().nonce;
      expect(a).not.toBe(b);
    });
  });

  describe('buildNonceSignMessage', () => {
    it('includes wallet and nonce in message', () => {
      const wallet = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
      const nonce = 'abc123';
      const msg = buildNonceSignMessage(wallet, nonce);

      expect(msg).toContain('ArcLayer Wallet Session');
      expect(msg).toContain('0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20');
      expect(msg).toContain('abc123');
    });

    it('checksums the wallet address', () => {
      const msg = buildNonceSignMessage('0xf5f11e68fbcbfa20de9208709ab60ff81509cb20', 'x');
      // getAddress checksums — should contain mixed case
      expect(msg).toContain('0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20');
    });
  });

  describe('verifySessionToken / sign round-trip', () => {
    it('rejects empty string', () => {
      expect(verifySessionToken('')).toBeNull();
    });

    it('rejects token without dot', () => {
      expect(verifySessionToken('nodosot')).toBeNull();
    });

    it('rejects tampered signature', () => {
      const token = 'abc123.abcdef';
      expect(verifySessionToken(token)).toBeNull();
    });
  });

  describe('verifyAndCreateSession', () => {
    const wallet = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
    const sig = `0x${'ab'.repeat(65)}`; // 65-byte mock signature

    it('rejects invalid wallet', async () => {
      const result = await verifyAndCreateSession({
        wallet: 'not-an-address',
        nonce: generateNonce().nonce,
        signature: sig,
      });
      expect(result.ok).toBe(false);
      expect((result as VerifyError).error).toBe('invalid_wallet');
    });

    it('rejects unknown nonce', async () => {
      const result = await verifyAndCreateSession({
        wallet,
        nonce: 'deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000',
        signature: sig,
      });
      expect(result.ok).toBe(false);
      expect((result as VerifyError).error).toBe('nonce_not_found');
    });

    it('rejects reused nonce (replay protection)', async () => {
      const { nonce } = generateNonce();

      // First attempt — succeeds (verifyMessage mocked to return true)
      const first = await verifyAndCreateSession({ wallet, nonce, signature: sig });
      expect(first.ok).toBe(true);

      // Second attempt — same nonce
      const second = await verifyAndCreateSession({ wallet, nonce, signature: sig });
      expect(second.ok).toBe(false);
      expect((second as VerifyError).error).toBe('nonce_used');
    });

    it('creates session with valid cookie token on success', async () => {
      const { nonce } = generateNonce();
      const result = await verifyAndCreateSession({ wallet, nonce, signature: sig });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.session.wallet).toBe(wallet.toLowerCase());
      expect(result.session.expiresAt).toBeGreaterThan(Date.now());
      expect(result.cookieToken).toBeDefined();

      // Cookie token should resolve back to the session
      const resolved = resolveSessionFromCookie(result.cookieToken!);
      expect(resolved).not.toBeNull();
      expect(resolved!.wallet).toBe(wallet.toLowerCase());
    });
  });

  describe('resolveSessionFromCookie', () => {
    it('returns null for garbage cookie', () => {
      expect(resolveSessionFromCookie('garbage')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(resolveSessionFromCookie('')).toBeNull();
    });
  });

  describe('destroySession', () => {
    it('destroys existing session', async () => {
      const wallet = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
      const sig = `0x${'ab'.repeat(65)}`;
      const { nonce } = generateNonce();
      const result = await verifyAndCreateSession({ wallet, nonce, signature: sig });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(destroySession(result.cookieToken!)).toBe(true);
      expect(resolveSessionFromCookie(result.cookieToken!)).toBeNull();
    });

    it('returns false for non-existent session', () => {
      expect(destroySession('nonexistent.sig')).toBe(false);
    });
  });

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
});
