'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  toPasskeyTransport,
  toWebAuthnCredential,
  toCircleSmartAccount,
  WebAuthnMode,
} from '@circle-fin/modular-wallets-core';
import {
  createBundlerClient,
  type BundlerClient,
} from 'viem/account-abstraction';
import { toWebAuthnAccount } from 'viem/account-abstraction';
import { type Address, type PublicClient } from 'viem';
import { arcTestnet } from '@arclayer/sdk';
import {
  CIRCLE_CLIENT_KEY,
  CIRCLE_CLIENT_URL,
  createArcModularTransport,
  createArcPublicClient,
} from '@/lib/circle';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CircleWalletState {
  ready: boolean;
  authenticated: boolean;
  address: Address | '';
  smartAccount: Awaited<ReturnType<typeof toCircleSmartAccount>> | null;
  bundlerClient: BundlerClient | null;
  publicClient: PublicClient | null;
  login: () => Promise<void>;
  register: (username: string) => Promise<void>;
  logout: () => void;
}

const DEFAULT_STATE: CircleWalletState = {
  ready: false,
  authenticated: false,
  address: '',
  smartAccount: null,
  bundlerClient: null,
  publicClient: null,
  login: async () => {},
  register: async () => {},
  logout: () => {},
};

const CircleWalletContext = createContext<CircleWalletState>(DEFAULT_STATE);

// ─── Storage keys ────────────────────────────────────────────────────────────

const CREDENTIAL_STORAGE_KEY = 'arclayer.circle.credential.v1';

// ─── Provider ────────────────────────────────────────────────────────────────

export function CircleWalletProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [credential, setCredential] = useState<Awaited<
    ReturnType<typeof toWebAuthnCredential>
  > | null>(null);
  const [smartAccount, setSmartAccount] = useState<Awaited<
    ReturnType<typeof toCircleSmartAccount>
  > | null>(null);
  const [bundlerClient, setBundlerClient] = useState<BundlerClient | null>(
    null,
  );

  const publicClient = useMemo(() => {
    if (!CIRCLE_CLIENT_KEY || !CIRCLE_CLIENT_URL) return null;
    return createArcPublicClient();
  }, []);

  const passkeyTransport = useMemo(() => {
    if (!CIRCLE_CLIENT_KEY || !CIRCLE_CLIENT_URL) return null;
    return toPasskeyTransport(CIRCLE_CLIENT_URL, CIRCLE_CLIENT_KEY);
  }, []);

  // Initialize smart account from credential
  const initSmartAccount = useCallback(
    async (cred: Awaited<ReturnType<typeof toWebAuthnCredential>>) => {
      if (!publicClient) return;

      const account = await toCircleSmartAccount({
        client: publicClient,
        owner: toWebAuthnAccount({ credential: cred }),
      });

      const transport = createArcModularTransport();
      const bundler = createBundlerClient({
        account,
        chain: arcTestnet,
        transport,
        paymaster: true, // Gasless via Circle Gas Station
      });

      setSmartAccount(account);
      setBundlerClient(bundler);
      setCredential(cred);

      // Persist credential ID for auto-login
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          CREDENTIAL_STORAGE_KEY,
          JSON.stringify({ id: cred.id, publicKey: cred.publicKey }),
        );
      }
    },
    [publicClient],
  );

  // Browser/passkey session policy:
  // Do NOT auto-call WebAuthn on mount. Browser passkey prompts are user-gesture
  // gated and can leave the tab/modal in a stuck state after users close the browser
  // (especially after a logout/refresh cycle). Login/register must be explicit
  // button actions, never page-load side-effects.
  useEffect(() => {
    setReady(true);
  }, []);

  // Register new passkey
  const register = useCallback(
    async (username: string) => {
      if (!passkeyTransport) throw new Error('Circle SDK not configured');

      const cred = await toWebAuthnCredential({
        transport: passkeyTransport,
        mode: WebAuthnMode.Register,
        username,
      });
      await initSmartAccount(cred);
    },
    [passkeyTransport, initSmartAccount],
  );

  // Login with existing passkey
  const login = useCallback(async () => {
    if (!passkeyTransport) throw new Error('Circle SDK not configured');

    const cred = await toWebAuthnCredential({
      transport: passkeyTransport,
      mode: WebAuthnMode.Login,
    });
    await initSmartAccount(cred);
  }, [passkeyTransport, initSmartAccount]);

  // Logout
  const logout = useCallback(() => {
    setCredential(null);
    setSmartAccount(null);
    setBundlerClient(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(CREDENTIAL_STORAGE_KEY);
      Object.keys(window.sessionStorage)
        .filter((key) => key.startsWith('x402_paid:'))
        .forEach((key) => window.sessionStorage.removeItem(key));
    }
  }, []);

  const value: CircleWalletState = useMemo(
    () => ({
      ready,
      authenticated: !!smartAccount,
      address: (smartAccount?.address as Address) || '',
      smartAccount,
      bundlerClient,
      publicClient,
      login,
      register,
      logout,
    }),
    [ready, smartAccount, bundlerClient, publicClient, login, register, logout],
  );

  return (
    <CircleWalletContext.Provider value={value}>
      {children}
    </CircleWalletContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useCircleWallet() {
  return useContext(CircleWalletContext);
}
