'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCircleWallet } from '@/hooks/useCircleWallet';
import { useAccount, useDisconnect } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { createPublicClient, formatUnits, getAddress, http, type Hex } from 'viem';
import { DevDetails } from '@/components/DevDetails';
import { NOTICE_INSUFFICIENT_USDC, NOTICE_PAYMENT_REQUIRED, NOTICE_PAYMENT_SETTLED, NOTICE_REPLAY_FAILED, NOTICE_REPLAY_REJECTED, NOTICE_RESOURCE_UNLOCKED, NOTICE_WALLET_NOT_CONNECTED, NOTICE_WRONG_CHAIN, useProtectionNotice } from '@/components/protection';
import { shortenAddress } from '@/lib/contracts';

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = 'https://rpc.testnet.arc.network';
const USDC = getAddress('0x3600000000000000000000000000000000000000');
const NETWORK = 'eip155:5042002';
const FALLBACK_PAY_TO = getAddress('0x4aA3402575b6D98EacE35A823EFa267F7365bdD2');

const BALANCE_ABI = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;

type PaymentMode = 'arc-native' | 'circle-gateway';
type WalletMode = 'passkey' | 'eoa' | null;
type Step = 'idle' | 'challenge' | 'signing' | 'paying' | 'replay' | 'done' | 'error';
type LogType = 'info' | 'success' | 'error' | 'warn';

interface LogLine { ts: string; msg: string; type: LogType }
interface RelayerStatus { ready: boolean; relayerAddress: string | null; usdcBalance: string; settleMode?: string; error?: string }
interface Requirement { scheme: 'exact'; network: string; asset: `0x${string}`; amount: string; payTo: `0x${string}`; maxTimeoutSeconds: number; extra?: Record<string, unknown> }
interface GatewayProbe { supported: boolean; network?: string; gatewayWallet?: string; error?: string }
interface GatewayBalance { depositedUsdc: string | null; poolUsdc?: string; method: string; note?: string; error?: string }

function nowTs() { return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function randomNonce(): Hex { return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex; }
function b64(value: unknown) { return btoa(JSON.stringify(value)); }

interface X402DemoPanelProps {
  /** When true, render compact inline variant suitable for homepage embedding. */
  compact?: boolean;
  /** Homepage hero variant: render only the payment ticket, no market/log cards. */
  ticketOnly?: boolean;
}

/**
 * X402DemoPanel — single source of truth for the live x402 protected-resource demo.
 *
 * Renders the full demo (PROTECTED RESOURCE card, mode picker, execution log, payment
 * ticket sidebar) on the standalone /x402-demo page. With `compact`, scales down the
 * same UI for inline use on the homepage. All payment logic — Arc Native EIP-3009 and
 * Circle Gateway batching — runs identically in both modes.
 */
export default function X402DemoPanel({ compact = false, ticketOnly = false }: X402DemoPanelProps) {
  const { authenticated, address: circleAddress, smartAccount, login } = useCircleWallet();
  const { address: eoaAddress, isConnected: eoaConnected } = useAccount();
  const { disconnect: eoaDisconnect } = useDisconnect();
  const { open: openAppKit } = useAppKit();
  const { notify } = useProtectionNotice();
  // Synchronous lock to prevent double-submit race condition.
  // setStep is async, so React can let two clicks through before the first
  // setStep('challenge') renders. useRef gives us instant rejection.
  const runLockRef = useRef(false);
  const [mode, setMode] = useState<PaymentMode>('arc-native');
  const [step, setStep] = useState<Step>('idle');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [txHash, setTxHash] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [replayResult, setReplayResult] = useState('Not run');
  const [relayer, setRelayer] = useState<RelayerStatus | null>(null);
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [gatewayProbe, setGatewayProbe] = useState<GatewayProbe | null>(null);
  const [gatewayBalance, setGatewayBalance] = useState<GatewayBalance | null>(null);

  const walletMode: WalletMode = eoaConnected ? 'eoa' : authenticated ? 'passkey' : null;
  const activeAddress = useMemo(() => {
    if (eoaConnected && eoaAddress) return eoaAddress as `0x${string}`;
    return (circleAddress as `0x${string}`) || undefined;
  }, [eoaConnected, eoaAddress, circleAddress]);
  const activeAuthed = eoaConnected || authenticated;
  const address = activeAddress || '';

  const log = useCallback((msg: string, type: LogType = 'info') => setLogs((prev) => [...prev, { ts: nowTs(), msg, type }]), []);

  useEffect(() => {
    fetch('/api/x402/relayer-status')
      .then((r) => r.json())
      .then(setRelayer)
      .catch((e) => setRelayer({ ready: false, relayerAddress: null, usdcBalance: '0', error: e instanceof Error ? e.message : String(e) }));
    fetch('/api/x402/gateway-status')
      .then((r) => r.json())
      .then((data) => {
        const gw = (data?.gateway ?? {}) as { ok?: boolean; network?: string; gatewayWallet?: string; error?: string };
        setGatewayProbe({
          supported: Boolean(gw.ok),
          network: gw.network,
          gatewayWallet: gw.gatewayWallet,
          error: gw.error,
        });
      })
      .catch(() => setGatewayProbe({ supported: false, error: 'probe_failed' }));
  }, []);

  useEffect(() => {
    if (!address) { setGatewayBalance(null); return; }
    fetch(`/api/x402/gateway-balance?address=${address}`)
      .then((r) => r.json())
      .then((data: GatewayBalance) => setGatewayBalance(data))
      .catch((e) => setGatewayBalance({ depositedUsdc: null, method: 'error', error: e instanceof Error ? e.message : String(e) }));
  }, [address]);

  useEffect(() => {
    if (!gatewayBalance || eoaConnected) return;
    const deposited = gatewayBalance.depositedUsdc;
    if (authenticated && deposited && Number(deposited) >= 0.05) setMode('circle-gateway');
  }, [gatewayBalance, authenticated, eoaConnected]);

  useEffect(() => {
    if (eoaConnected && mode === 'circle-gateway') setMode('arc-native');
  }, [eoaConnected, mode]);

  useEffect(() => {
    if (authenticated && !eoaConnected && mode === 'arc-native') setMode('circle-gateway');
  }, [authenticated, eoaConnected, mode]);


  const reset = useCallback(() => {
    runLockRef.current = false;
    setLogs([]); setTxHash(''); setUnlocked(false); setReplayResult('Not run'); setRequirement(null); setStep('idle');
  }, []);

  /* ─── ARC NATIVE FLOW ─── */
  const runArcNative = useCallback(async (wallet: { address: string; switchChain: (id: number) => Promise<void>; getEthereumProvider: () => Promise<{ request: (args: { method: string; params: unknown[] }) => Promise<unknown> }> }) => {
    const address = wallet.address as `0x${string}`;

    try {
      await wallet.switchChain(ARC_CHAIN_ID);
      log(`Wallet connected on Arc: ${shortenAddress(address)}`);
    } catch (e) {
      log(`Failed to switch to Arc Testnet: ${e instanceof Error ? e.message : String(e)}`, 'error');
      notify(NOTICE_WRONG_CHAIN);
      setStep('error'); return;
    }

    setStep('challenge');
    log('1/6 Requesting protected resource without payment...');
    const first = await fetch('/api/x402-demo/protected');
    const challenge = await first.json();
    if (first.status !== 402 || !Array.isArray(challenge.accepts)) { log('Protected endpoint did not return x402 402 challenge', 'error'); setStep('error'); return; }
    const accepts = challenge.accepts as Requirement[];
    const req = accepts.find((a) => !a.extra?.name || a.extra?.name === 'USDC') || accepts[0];
    setRequirement(req);
    log(`2/6 Received 402 Payment Required: ${formatUnits(BigInt(req.amount), 6)} USDC`, 'success');
    notify(NOTICE_PAYMENT_REQUIRED);

    const client = createPublicClient({ transport: http(ARC_RPC) });
    const balance = await client.readContract({ address: USDC, abi: BALANCE_ABI, functionName: 'balanceOf', args: [address] });
    log(`Payer USDC balance: ${formatUnits(balance, 6)} USDC`);
    if (balance < BigInt(req.amount)) {
      log(`Insufficient USDC. Need ${formatUnits(BigInt(req.amount), 6)} USDC.`, 'error');
      notify(NOTICE_INSUFFICIENT_USDC);
      setStep('error'); return;
    }

    setStep('signing');
    const validBefore = String(Math.floor(Date.now() / 1000) + 600);
    const nonce = randomNonce();

    const paymentPayload = {
      x402Version: 2,
      accepted: { ...req, asset: getAddress(req.asset), payTo: getAddress(req.payTo), extra: { name: 'USDC', version: '2', decimals: 6, symbol: 'USDC' } },
      payload: {
        signature: '0x' as Hex,
        authorization: { from: address, to: getAddress(req.payTo), value: req.amount, validAfter: '0', validBefore, nonce },
      },
    };

    log('3/6 Signing EIP-3009 transferWithAuthorization...');
    try {
      const provider = await wallet.getEthereumProvider();
      paymentPayload.payload.signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify({
          types: {
            EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
            TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }],
          },
          primaryType: 'TransferWithAuthorization',
          domain: { name: 'USDC', version: '2', chainId: ARC_CHAIN_ID, verifyingContract: USDC },
          message: { from: address, to: getAddress(req.payTo), value: `0x${BigInt(req.amount).toString(16)}`, validAfter: '0x0', validBefore: `0x${BigInt(validBefore).toString(16)}`, nonce },
        })],
      }) as Hex;
      log(`Signature created: ${paymentPayload.payload.signature.slice(0, 18)}...`, 'success');
    } catch (e) { log(`Signature failed: ${e instanceof Error ? e.message : String(e)}`, 'error'); setStep('error'); return; }

    setStep('paying');
    log('4/6 Calling protected resource with X-PAYMENT header (server runs verify+settle inline)...');
    const header = b64(paymentPayload);
    const paid = await fetch('/api/x402-demo/protected', { headers: { 'X-PAYMENT': header } });
    const paidJson = await paid.json();
    if (!paid.ok || !paidJson.unlocked) {
      log(`Payment failed: ${paidJson.error || paid.status} — ${paidJson.reason || paidJson.message || ''}`, 'error');
      setStep('error'); return;
    }

    // Decode PAYMENT-RESPONSE header for tx hash
    const paymentRespHeader = paid.headers.get('PAYMENT-RESPONSE') || paid.headers.get('payment-response');
    let paymentResp: { transaction?: string; payer?: string; mode?: string; paymentId?: string } = {};
    if (paymentRespHeader) {
      try {
        const padded = paymentRespHeader.replace(/-/g, '+').replace(/_/g, '/').padEnd(paymentRespHeader.length + ((4 - (paymentRespHeader.length % 4)) % 4), '=');
        paymentResp = JSON.parse(atob(padded));
      } catch { /* ignore */ }
    }
    if (paymentResp.transaction) setTxHash(paymentResp.transaction);
    setUnlocked(true);
    log(`5/6 Settled & unlocked: tx=${paymentResp.transaction?.slice(0, 18) || 'n/a'}...`, 'success');
    notify({
      ...NOTICE_PAYMENT_SETTLED,
      title: `−${formatUnits(BigInt(req.amount), 6)} USDC settled`,
      message: `On-chain settlement confirmed. Your wallet was charged ${formatUnits(BigInt(req.amount), 6)} USDC via EIP-3009.`,
      technicalDetail: paymentResp.transaction ? `tx: ${paymentResp.transaction}` : 'settled',
    });
    notify(NOTICE_RESOURCE_UNLOCKED);

    setStep('replay');
    log('6/6 Replay test: reusing same X-PAYMENT against /api/x402-demo/protected...');
    const replay = await fetch('/api/x402-demo/protected', { headers: { 'X-PAYMENT': header } });
    const replayJson = await replay.json();
    const rejected = !replay.ok && (replayJson.error === 'payment_replayed' || replayJson.error === 'native_payment_replayed' || replayJson.error === 'nonce_used' || replayJson.error === 'payment_already_used');
    setReplayResult(rejected ? `Rejected: ${replayJson.error}` : `Unexpected: ${JSON.stringify(replayJson).slice(0, 80)}`);
    log(rejected ? `Replay rejected: ${replayJson.error} ✓` : 'Replay test did not return expected rejection', rejected ? 'success' : 'error');
    if (rejected) {
      notify({ ...NOTICE_REPLAY_REJECTED, technicalDetail: `Replay rejected: ${replayJson.error}`, message: 'This Arc Native EIP-3009 payment receipt was already consumed and cannot unlock the protected resource again.' });
    } else {
      notify(NOTICE_REPLAY_FAILED);
    }
    setStep(rejected ? 'done' : 'error');
  }, [log, notify]);

  /* ─── CIRCLE GATEWAY FLOW ─── */
  const runGateway = useCallback(async (wallet: { address: string; switchChain: (id: number) => Promise<void>; getEthereumProvider: () => Promise<{ request: (args: { method: string; params: unknown[] }) => Promise<unknown> }> }) => {
    const address = wallet.address as `0x${string}`;

    try {
      await wallet.switchChain(ARC_CHAIN_ID);
      log(`Wallet connected on Arc: ${shortenAddress(address)}`);
    } catch (e) {
      log(`Failed to switch to Arc Testnet: ${e instanceof Error ? e.message : String(e)}`, 'error');
      notify(NOTICE_WRONG_CHAIN);
      setStep('error'); return;
    }

    setStep('challenge');
    log('[GW] 1/5 Requesting protected resource without payment...');
    const first = await fetch('/api/x402-demo/protected');
    const challenge = await first.json();
    if (first.status !== 402 || !Array.isArray(challenge.accepts)) { log('Protected endpoint did not return x402 402 challenge', 'error'); setStep('error'); return; }

    const accepts = challenge.accepts as Requirement[];
    const gwOption = accepts.find((a) => a.extra?.name === 'GatewayWalletBatched' || a.extra?.transferMethod === 'gateway-batched-eip3009');
    if (!gwOption) { log('No GatewayWalletBatched option in 402 response. Gateway may not be enabled.', 'error'); setStep('error'); return; }
    setRequirement(gwOption);
    log(`[GW] 2/5 Found Gateway option: ${formatUnits(BigInt(gwOption.amount), 6)} USDC via ${gwOption.extra?.name}`, 'success');

    const client = createPublicClient({ transport: http(ARC_RPC) });
    const balance = await client.readContract({ address: USDC, abi: BALANCE_ABI, functionName: 'balanceOf', args: [address] });
    log(`Payer USDC balance: ${formatUnits(balance, 6)} USDC`);
    if (balance < BigInt(gwOption.amount)) {
      log(`Insufficient USDC. Need ${formatUnits(BigInt(gwOption.amount), 6)} USDC.`, 'error');
      notify(NOTICE_INSUFFICIENT_USDC);
      setStep('error'); return;
    }

    setStep('signing');
    const validBefore = String(Math.floor(Date.now() / 1000) + 604900);
    const nonce = randomNonce();
    const gwDomainName = String(gwOption.extra?.name || 'GatewayWalletBatched');
    const gwDomainVersion = String(gwOption.extra?.version || '1');
    const gwVerifyingContract = getAddress(String(gwOption.extra?.verifyingContract || USDC));

    const paymentPayload = {
      x402Version: 2,
      resource: `${window.location.origin}/api/x402-demo/protected`,
      accepted: { ...gwOption, asset: getAddress(gwOption.asset), payTo: getAddress(gwOption.payTo), extra: { ...gwOption.extra, name: gwDomainName } },
      payload: {
        signature: '0x' as Hex,
        authorization: { from: address, to: getAddress(gwOption.payTo), value: gwOption.amount, validAfter: '0', validBefore, nonce },
      },
    };

    log('[GW] 3/5 Signing EIP-3009 for Gateway batching...');
    log(`[GW] Domain: name=${gwDomainName} version=${gwDomainVersion} verifyingContract=${gwVerifyingContract.slice(0, 10)}...`);
    try {
      const provider = await wallet.getEthereumProvider();
      paymentPayload.payload.signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify({
          types: {
            EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
            TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }],
          },
          primaryType: 'TransferWithAuthorization',
          domain: { name: gwDomainName, version: gwDomainVersion, chainId: ARC_CHAIN_ID, verifyingContract: gwVerifyingContract },
          message: { from: address, to: getAddress(gwOption.payTo), value: `0x${BigInt(gwOption.amount).toString(16)}`, validAfter: '0x0', validBefore: `0x${BigInt(validBefore).toString(16)}`, nonce },
        })],
      }) as Hex;
      log(`Signature created: ${paymentPayload.payload.signature.slice(0, 18)}...`, 'success');
    } catch (e) { log(`Signature failed: ${e instanceof Error ? e.message : String(e)}`, 'error'); setStep('error'); return; }

    setStep('paying');
    log('[GW] 4/5 Calling protected resource with PAYMENT-SIGNATURE header (server runs verify+settle inline)...');
    const header = b64(paymentPayload);
    const paid = await fetch('/api/x402-demo/protected', { headers: { 'PAYMENT-SIGNATURE': header } });
    const paidJson = await paid.json();
    if (!paid.ok || !paidJson.unlocked) { log(`Gateway payment failed: ${paidJson.error || paid.status} — ${paidJson.reason || paidJson.message || ''}`, 'error'); setStep('error'); return; }

    const paymentRespHeader = paid.headers.get('PAYMENT-RESPONSE') || paid.headers.get('payment-response');
    let paymentResp: { transaction?: string; payer?: string; mode?: string; paymentId?: string } = {};
    if (paymentRespHeader) {
      try {
        const padded = paymentRespHeader.replace(/-/g, '+').replace(/_/g, '/').padEnd(paymentRespHeader.length + ((4 - (paymentRespHeader.length % 4)) % 4), '=');
        paymentResp = JSON.parse(atob(padded));
      } catch { /* ignore */ }
    }
    if (paymentResp.transaction) setTxHash(paymentResp.transaction || '');
    setUnlocked(true);
    log(`[GW] Settled & unlocked via Circle Gateway: ${paymentResp.transaction?.slice(0, 18) || 'batched'}...`, 'success');
    notify({
      ...NOTICE_PAYMENT_SETTLED,
      title: `−${formatUnits(BigInt(gwOption.amount), 6)} USDC settled`,
      message: `Circle Gateway settlement confirmed. Your wallet was charged ${formatUnits(BigInt(gwOption.amount), 6)} USDC via EIP-3009.`,
      technicalDetail: paymentResp.transaction ? `tx: ${paymentResp.transaction}` : 'batched settlement',
    });
    notify(NOTICE_RESOURCE_UNLOCKED);

    setStep('replay');
    log('[GW] 5/5 Replay test: reusing same PAYMENT-SIGNATURE...');
    const replayResp = await fetch('/api/x402-demo/protected', { headers: { 'PAYMENT-SIGNATURE': header } });
    const replayJson = await replayResp.json();
    const replayRejected = !replayResp.ok || replayJson.error === 'payment_replayed' || replayJson.error === 'gateway_payment_replayed' || replayJson.error === 'nonce_used' || replayJson.error === 'payment_already_used';
    if (replayRejected) {
      const reason = replayJson.error || 'gateway_payment_replayed';
      setReplayResult(`Rejected: ${reason}`);
      log(`[GW] Receipt already used protection verified ✓`, 'success');
      log(`[GW] Replay rejected: ${reason} ✓`, 'success');
      notify({ ...NOTICE_REPLAY_REJECTED, message: 'This Circle Gateway payment receipt was already consumed and cannot unlock the protected resource again.', technicalDetail: `Replay rejected: ${reason}` });
    } else {
      setReplayResult('Unexpected: replay unlocked resource');
      log('[GW] Replay unexpectedly unlocked resource', 'error');
      notify(NOTICE_REPLAY_FAILED);
    }
    setStep(replayRejected ? 'done' : 'error');
  }, [log, notify]);

  const runDemo = useCallback(async () => {
    // Synchronous double-submit guard — prevents two flows with different nonces.
    // Must happen before reset(); reset intentionally clears stale locks.
    if (runLockRef.current) return;

    reset();
    runLockRef.current = true;
    if (!activeAuthed || !address) {
      log('No wallet connected', 'error');
      notify({ ...NOTICE_WALLET_NOT_CONNECTED, surface: 'toast', autoCloseMs: 4_500 });
      setStep('error'); return;
    }

    // Wallet ↔ rail isolation: Circle Gateway requires Circle Modular Wallet (passkey).
    if (mode === 'circle-gateway' && walletMode !== 'passkey') {
      log('Circle Gateway requires Circle Wallet (passkey). Switch to ARC NATIVE for EOA.', 'error');
      notify({ ...NOTICE_WALLET_NOT_CONNECTED, surface: 'toast', autoCloseMs: 4_500, message: 'Circle Gateway needs a Circle Wallet. Use Arc Native for EOA.' });
      setStep('error');
      runLockRef.current = false;
      return;
    }

    const wallet = walletMode === 'passkey'
      ? {
          address: address as string,
          switchChain: async (_id: number) => { /* Circle is already on Arc */ },
          getEthereumProvider: async () => ({
            request: async (args: { method: string; params: unknown[] }) => {
              if (!smartAccount) throw new Error('Circle smart account not ready');
              if (args.method === 'eth_signTypedData_v4') {
                const typedData = JSON.parse(args.params[1] as string);
                return smartAccount.signTypedData({
                  domain: typedData.domain,
                  types: typedData.types,
                  primaryType: typedData.primaryType,
                  message: typedData.message,
                });
              }
              throw new Error(`Unsupported method: ${args.method}`);
            },
          }),
        }
      : {
          address: address as string,
          switchChain: async (id: number) => {
            const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
            if (!eth) throw new Error('No injected wallet found');
            try {
              await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${id.toString(16)}` }] });
            } catch (e) {
              const err = e as { code?: number };
              if (err.code === 4902) {
                await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${id.toString(16)}`, chainName: 'Arc Testnet', nativeCurrency: { name: 'Arc', symbol: 'ARC', decimals: 18 }, rpcUrls: [ARC_RPC], blockExplorerUrls: ['https://testnet.arcscan.app'] }] });
                return;
              }
              throw e;
            }
          },
          getEthereumProvider: async () => {
            const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
            if (!eth) throw new Error('No injected wallet found');
            return eth;
          },
        };

    try {
      if (mode === 'arc-native') {
        await runArcNative(wallet as unknown as Parameters<typeof runArcNative>[0]);
      } else {
        await runGateway(wallet as unknown as Parameters<typeof runGateway>[0]);
      }
    } finally {
      // Release lock — operator may RUN AGAIN after success or error
      runLockRef.current = false;
    }
  }, [activeAuthed, address, walletMode, smartAccount, log, reset, mode, runArcNative, runGateway, notify]);

  const connectSelectedWallet = useCallback(() => {
    if (mode === 'circle-gateway') {
      void login();
      return;
    }
    openAppKit();
  }, [login, mode, openAppKit]);

  const busy = !['idle', 'done', 'error'].includes(step);
  // After successful payment, keep button disabled for 5s to prevent accidental re-pay
  const [cooldown, setCooldown] = useState(false);
  useEffect(() => {
    if (step === 'done') {
      setCooldown(true);
      const t = setTimeout(() => setCooldown(false), 5000);
      return () => clearTimeout(t);
    }
  }, [step]);
  const payTo = requirement?.payTo || relayer?.relayerAddress || FALLBACK_PAY_TO;
  const arcDisabledForPasskey = walletMode === 'passkey';
  const circleDisabledForEoa = walletMode === 'eoa';
  const connectLabel = mode === 'circle-gateway' ? 'CONNECT CIRCLE PASSKEY' : 'CONNECT WALLET';

  // Compact-aware sizing tokens
  const c = {
    headTitle: compact ? 'text-xl md:text-2xl' : 'text-3xl md:text-5xl',
    sectionTitle: compact ? 'text-base md:text-lg' : 'text-2xl',
    cardPad: compact ? 'p-3.5' : 'p-5',
    cardPadXs: compact ? 'p-3' : 'p-4',
    cardRadius: compact ? 'rounded-xl' : 'rounded-2xl',
    cardRadiusXs: compact ? 'rounded-lg' : 'rounded-xl',
    label: compact ? 'text-[9px]' : 'text-[10px]',
    bigVal: compact ? 'text-base' : 'text-2xl',
    body: compact ? 'text-[11px]' : 'text-sm',
    logMax: compact ? 'max-h-[200px]' : 'max-h-[340px]',
    logFont: compact ? 'text-[10px]' : 'text-[10.5px]',
    btnPad: compact ? 'py-2' : 'py-3',
    btnFont: compact ? 'text-[10px]' : 'text-[11px]',
    grid: compact ? 'lg:grid-cols-[1fr_320px]' : 'lg:grid-cols-[1fr_380px]',
    gap: compact ? 'gap-3' : 'gap-5',
  };

  if (ticketOnly) {
    return (
      <aside className="w-full max-w-[440px]">
        <div className={`${c.cardRadius} border border-white/10 bg-[#111]/95 ${c.cardPad} shadow-2xl shadow-black/40`}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className={`font-semibold tracking-[-0.03em] text-white ${compact ? 'text-base' : 'text-xl'}`}>Unlock x402</h3>
            <span className={`rounded-full px-2 py-0.5 font-mono ${c.label} ${mode === 'arc-native' ? 'bg-[#C5A67C]/15 text-[#C5A67C]' : 'bg-[#7CB5C5]/15 text-[#7CB5C5]'}`}>{mode === 'arc-native' ? 'ARC' : 'CIRCLE GATEWAY'}</span>
          </div>
          <div className={`mb-3 grid grid-cols-2 overflow-hidden ${c.cardRadiusXs} border border-white/10 bg-black/25 p-1`}>
            <button onClick={() => setMode('arc-native')} disabled={arcDisabledForPasskey} className={`cursor-pointer rounded-lg ${c.btnPad} font-mono ${c.btnFont} disabled:cursor-not-allowed disabled:opacity-40 ${mode === 'arc-native' ? 'bg-[#C5A67C] text-black' : 'text-white/80'}`}>ARC</button>
            <button onClick={() => setMode('circle-gateway')} disabled={circleDisabledForEoa} className={`cursor-pointer rounded-lg ${c.btnPad} font-mono ${c.btnFont} disabled:cursor-not-allowed disabled:opacity-40 ${mode === 'circle-gateway' ? 'bg-[#7CB5C5] text-black' : 'text-white/80'}`}>CIRCLE GATEWAY</button>
          </div>
          <div className={`space-y-2.5 border-y border-white/10 py-3 font-mono ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
            <div className="flex justify-between gap-4"><span className="text-white/80">Cost</span><span className="text-white">0.01 USDC</span></div>
            <div className="flex justify-between gap-4"><span className="text-white/80">Network</span><span className="text-white">Arc Testnet</span></div>
            <div className="flex justify-between gap-4"><span className="text-white/80">Current step</span><span className={mode === 'arc-native' ? 'text-[#C5A67C]' : 'text-[#7CB5C5]'}>{step.toUpperCase()}</span></div>
            <div className="flex justify-between gap-4">
              <span className="text-white/80">Status</span>
              <span className={`inline-flex items-center gap-1.5 ${unlocked ? 'text-green-400' : 'text-red-400'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${unlocked ? 'bg-green-400' : 'bg-red-400'}`} />
                {unlocked ? (
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                )}
                {unlocked ? 'UNLOCK' : 'LOCK'}
              </span>
            </div>
            <div className="flex justify-between gap-4"><span className="text-white/80">Replay guard</span><span className={replayResult.startsWith('Rejected') ? 'text-red-300' : replayResult.startsWith('Unexpected') ? 'text-green-300' : 'text-white/80'}>{replayResult}</span></div>
          </div>
          <div className="mt-3 space-y-2.5">
            {!activeAuthed ? (
              <button onClick={connectSelectedWallet} className={`w-full cursor-pointer ${c.cardRadiusXs} border border-white/20 bg-white/[0.06] ${c.btnPad} font-mono ${c.btnFont} tracking-[0.14em] text-white hover:bg-white/[0.12]`}>{connectLabel}</button>
            ) : (
              <>
                <div className={`flex items-center gap-2 font-mono ${c.label} text-white/60`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                  {walletMode === 'eoa' ? 'EOA' : 'PASSKEY'} · {shortenAddress(address)}
                </div>
                <button onClick={busy || cooldown ? undefined : runDemo} disabled={busy || cooldown || relayer?.ready === false} className={`w-full cursor-pointer ${c.cardRadiusXs} border ${c.btnPad} font-mono ${c.btnFont} tracking-[0.14em] transition-all disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/80 ${mode === 'arc-native' ? 'border-[#C5A67C]/50 bg-[#C5A67C] text-[#050505] hover:bg-[#d5b78a]' : 'border-[#7CB5C5]/50 bg-[#7CB5C5] text-[#050505] hover:bg-[#91cadb]'}`}>
                  {busy ? `RUNNING: ${step.toUpperCase()}` : cooldown ? 'PAID ✓ (cooldown)' : step === 'done' ? 'RUN AGAIN' : `BUY ACCESS`}
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <div className={`grid ${c.gap} ${c.grid}`}>
      {/* ─── Left column: protected resource + mode picker + log ─── */}
      <section className={compact ? 'space-y-3' : 'space-y-5'}>
        {/* Header (compact only — full page renders its own header outside) */}
        {compact && (
          <div className="flex flex-col gap-1 border-b border-white/10 pb-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-1 font-mono text-[9px] tracking-[0.24em] text-[#C5A67C]">ARCLAYER x402 MARKET</div>
              <h2 className={`font-semibold tracking-[-0.04em] text-white ${c.headTitle}`}>Pay per API call</h2>
            </div>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-white/80 sm:mt-0">
              <span className={activeAuthed ? 'h-1.5 w-1.5 rounded-full bg-green-400' : 'h-1.5 w-1.5 rounded-full bg-yellow-400'} />
              {activeAuthed && address ? `${walletMode === 'eoa' ? 'EOA' : 'PASSKEY'} · ${shortenAddress(address)}` : 'Wallet not connected'}
            </div>
          </div>
        )}

        {/* PROTECTED RESOURCE card */}
        <div className={`${c.cardRadius} border border-white/10 bg-[#111]/80 ${c.cardPad} shadow-2xl shadow-black/30`}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className={`mb-1.5 font-mono ${c.label} tracking-[0.2em] text-white/80`}>PROTECTED RESOURCE</div>
              <h3 className={`font-semibold tracking-[-0.03em] text-white ${c.sectionTitle}`}>Will this API unlock after x402 payment?</h3>
              <p className={`mt-1.5 font-mono text-white/80 ${compact ? 'text-[11px]' : 'text-[12px]'}`}>/api/x402-demo/protected</p>
            </div>
            <div className={`rounded-full bg-green-500/15 px-2.5 py-0.5 font-mono ${c.label} text-green-300`}>LIVE</div>
          </div>

          <div className="grid gap-2.5 md:grid-cols-3">
            <div className={`${c.cardRadiusXs} border border-white/10 bg-black/25 ${c.cardPadXs}`}>
              <div className={`font-mono ${c.label} text-white/80`}>PRICE</div>
              <div className={`mt-0.5 font-semibold text-white ${c.bigVal}`}>0.01 USDC</div>
              <div className="mt-0.5 text-[10px] text-white/80">per resource unlock</div>
            </div>
            <div className={`${c.cardRadiusXs} border border-white/10 bg-black/25 ${c.cardPadXs}`}>
              <div className={`font-mono ${c.label} text-white/80`}>RELAYER</div>
              <div className={`mt-0.5 font-semibold ${relayer?.ready ? 'text-green-300' : 'text-red-300'} ${c.bigVal}`}>{relayer?.ready ? 'Ready' : 'Offline'}</div>
              <div className="mt-0.5 text-[10px] text-white/80">{relayer?.relayerAddress ? shortenAddress(relayer.relayerAddress) : 'not configured'}</div>
            </div>
            <div className={`${c.cardRadiusXs} border border-white/10 bg-black/25 ${c.cardPadXs}`}>
              <div className={`font-mono ${c.label} text-white/80`}>CIRCLE GATEWAY</div>
              <div className={`mt-0.5 font-semibold ${gatewayProbe?.supported ? 'text-green-300' : 'text-yellow-300'} ${c.bigVal}`}>{gatewayProbe?.supported ? 'Supported' : 'Checking'}</div>
              <div className="mt-0.5 text-[10px] text-white/80">{gatewayProbe?.gatewayWallet ? shortenAddress(gatewayProbe.gatewayWallet) : 'arcTestnet'}</div>
            </div>
          </div>
        </div>

        {/* Mode picker */}
        <div className="grid gap-3 md:grid-cols-2">
          <button onClick={() => setMode('arc-native')} disabled={arcDisabledForPasskey} className={`cursor-pointer ${c.cardRadius} border ${c.cardPad} text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 ${mode === 'arc-native' ? 'border-[#C5A67C]/70 bg-[#C5A67C]/10 shadow-lg shadow-[#C5A67C]/10' : 'border-white/10 bg-white/[0.025] hover:border-white/25'}`}>
            <div className="mb-3 flex items-center justify-between">
              <span className={`font-mono ${c.label} tracking-[0.18em] text-[#C5A67C]`}>ARC NATIVE</span>
              <span className={`rounded-full bg-green-500/15 px-2 py-0.5 font-mono ${c.label} text-green-300`}>RECOMMENDED</span>
            </div>
            <div className={`font-semibold text-white ${compact ? 'text-base' : 'text-xl'}`}>EOA pay-per-call</div>
            <p className={`mt-1.5 leading-5 text-white/80 ${c.body}`}>No deposit. Sign one EIP-3009 authorization and settle USDC directly on Arc.</p>
            <div className={`mt-3 grid grid-cols-2 gap-2 font-mono ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
              <div className={`${c.cardRadiusXs} bg-black/25 ${c.cardPadXs}`}><div className="text-white/80">Deposit</div><div className="text-green-300">Not required</div></div>
              <div className={`${c.cardRadiusXs} bg-black/25 ${c.cardPadXs}`}><div className="text-white/80">Best for</div><div className="text-white/70">Occasional calls</div></div>
            </div>
          </button>

          <button onClick={() => setMode('circle-gateway')} disabled={circleDisabledForEoa} className={`cursor-pointer ${c.cardRadius} border ${c.cardPad} text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 ${mode === 'circle-gateway' ? 'border-[#7CB5C5]/70 bg-[#7CB5C5]/10 shadow-lg shadow-[#7CB5C5]/10' : 'border-white/10 bg-white/[0.025] hover:border-white/25'}`}>
            <div className="mb-3 flex items-center justify-between">
              <span className={`font-mono ${c.label} tracking-[0.18em] text-[#7CB5C5]`}>CIRCLE GATEWAY</span>
              <span className={`rounded-full bg-white/10 px-2 py-0.5 font-mono ${c.label} text-white/80`}>POWER USER</span>
            </div>
            <div className={`font-semibold text-white ${compact ? 'text-base' : 'text-xl'}`}>Pre-funded execution</div>
            <p className={`mt-1.5 leading-5 text-white/80 ${c.body}`}>Deposit once, then execute high-frequency agent payments through Gateway batching.</p>
            <div className={`mt-3 grid grid-cols-2 gap-2 font-mono ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
              <div className={`${c.cardRadiusXs} bg-black/25 ${c.cardPadXs}`}><div className="text-white/80">Your deposit</div><div className={gatewayBalance?.depositedUsdc && Number(gatewayBalance.depositedUsdc) > 0 ? 'text-green-300' : 'text-yellow-300'}>{gatewayBalance?.depositedUsdc ?? '0'} USDC</div></div>
              <div className={`${c.cardRadiusXs} bg-black/25 ${c.cardPadXs}`}><div className="text-white/80">Best for</div><div className="text-white/70">HFT agents</div></div>
            </div>
          </button>
        </div>

        {/* Execution log */}
        <div className={`${c.cardRadius} border border-white/10 bg-white/[0.025] ${c.cardPad}`}>
          <div className={`mb-2 font-mono ${c.label} tracking-[0.2em] text-white/80`}>EXECUTION LOG</div>
          {logs.length > 0 ? (
            <div className={`overflow-y-auto font-mono leading-[1.9] ${c.logMax} ${c.logFont}`}>
              {logs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 text-white/80">{l.ts}</span>
                  <span className={l.type === 'success' ? 'text-green-400/80' : l.type === 'error' ? 'text-red-400/80' : l.type === 'warn' ? 'text-yellow-400/80' : 'text-white/80'}>{l.msg}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className={`font-mono text-white/80 ${compact ? 'text-[10.5px]' : 'text-[11px]'}`}>No execution yet. Connect wallet and run the payment ticket.</div>
          )}
        </div>
      </section>

      {/* ─── Right column: payment ticket sidebar ─── */}
      <aside className={compact ? '' : 'lg:sticky lg:top-6 lg:self-start'}>
        <div className={`${c.cardRadius} border border-white/10 bg-[#111]/95 ${c.cardPad} shadow-2xl shadow-black/40`}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className={`font-semibold tracking-[-0.03em] text-white ${compact ? 'text-base' : 'text-xl'}`}>Unlock x402</h3>
            <span className={`rounded-full px-2 py-0.5 font-mono ${c.label} ${mode === 'arc-native' ? 'bg-[#C5A67C]/15 text-[#C5A67C]' : 'bg-[#7CB5C5]/15 text-[#7CB5C5]'}`}>{mode === 'arc-native' ? 'ARC' : 'CIRCLE GATEWAY'}</span>
          </div>

          <div className={`mb-3 grid grid-cols-2 overflow-hidden ${c.cardRadiusXs} border border-white/10 bg-black/25 p-1`}>
            <button onClick={() => setMode('arc-native')} disabled={arcDisabledForPasskey} className={`cursor-pointer rounded-lg ${c.btnPad} font-mono ${c.btnFont} disabled:cursor-not-allowed disabled:opacity-40 ${mode === 'arc-native' ? 'bg-[#C5A67C] text-black' : 'text-white/80'}`}>ARC</button>
            <button onClick={() => setMode('circle-gateway')} disabled={circleDisabledForEoa} className={`cursor-pointer rounded-lg ${c.btnPad} font-mono ${c.btnFont} disabled:cursor-not-allowed disabled:opacity-40 ${mode === 'circle-gateway' ? 'bg-[#7CB5C5] text-black' : 'text-white/80'}`}>CIRCLE GATEWAY</button>
          </div>

          <div className={`space-y-2.5 border-y border-white/10 py-3 font-mono ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
            <div className="flex justify-between gap-4"><span className="text-white/80">Cost</span><span className="text-white">0.01 USDC</span></div>
            <div className="flex justify-between gap-4"><span className="text-white/80">Network</span><span className="text-white">Arc Testnet</span></div>
            <div className="flex justify-between gap-4"><span className="text-white/80">Current step</span><span className={mode === 'arc-native' ? 'text-[#C5A67C]' : 'text-[#7CB5C5]'}>{step.toUpperCase()}</span></div>
            <div className="flex justify-between gap-4">
              <span className="text-white/80">Status</span>
              <span className={`inline-flex items-center gap-1.5 ${unlocked ? 'text-green-400' : 'text-red-400'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${unlocked ? 'bg-green-400' : 'bg-red-400'}`} />
                {unlocked ? (
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                )}
                {unlocked ? 'UNLOCK' : 'LOCK'}
              </span>
            </div>
            <div className="flex justify-between gap-4"><span className="text-white/80">Replay guard</span><span className={replayResult.startsWith('Rejected') ? 'text-red-300' : replayResult.startsWith('Unexpected') ? 'text-green-300' : 'text-white/80'}>{replayResult}</span></div>
          </div>

          {mode === 'circle-gateway' && (!gatewayBalance?.depositedUsdc || Number(gatewayBalance.depositedUsdc) <= 0) && (
            <div className={`mt-3 ${c.cardRadiusXs} border border-yellow-400/20 bg-yellow-400/10 p-2.5 font-mono leading-5 text-yellow-100/80 ${compact ? 'text-[10.5px]' : 'text-[11px]'}`}>
              Gateway balance is empty for this Circle wallet. Deposit USDC into GatewayWallet first, or connect an EOA for Arc Native no-deposit execution.
            </div>
          )}

          <div className="mt-3 space-y-2.5">
            {!activeAuthed ? (
              <>
                <button onClick={connectSelectedWallet} className={`w-full cursor-pointer ${c.cardRadiusXs} border border-white/20 bg-white/[0.06] ${c.btnPad} font-mono ${c.btnFont} tracking-[0.14em] text-white hover:bg-white/[0.12]`}>{connectLabel}</button>
              </>
            ) : (
              <>
                <div className={`flex items-center gap-2 font-mono ${c.label} text-white/60`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                  {walletMode === 'eoa' ? 'EOA' : 'PASSKEY'} · {shortenAddress(address)}
                </div>
                <button onClick={busy || cooldown ? undefined : runDemo} disabled={busy || cooldown || relayer?.ready === false} className={`w-full cursor-pointer ${c.cardRadiusXs} border ${c.btnPad} font-mono ${c.btnFont} tracking-[0.14em] transition-all disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/80 ${mode === 'arc-native' ? 'border-[#C5A67C]/50 bg-[#C5A67C] text-[#050505] hover:bg-[#d5b78a]' : 'border-[#7CB5C5]/50 bg-[#7CB5C5] text-[#050505] hover:bg-[#91cadb]'}`}>
                  {busy ? `RUNNING: ${step.toUpperCase()}` : cooldown ? 'PAID ✓ (cooldown)' : step === 'done' ? 'RUN AGAIN' : `BUY ACCESS`}
                </button>
                <button onClick={() => eoaConnected ? eoaDisconnect() : undefined} className={`mt-1.5 w-full cursor-pointer ${c.cardRadiusXs} border border-white/10 ${compact ? 'py-1.5' : 'py-2'} font-mono ${c.label} tracking-[0.14em] text-white/80 hover:border-white/20`}>DISCONNECT</button>
              </>
            )}
            <button onClick={reset} className={`mt-1 w-full cursor-pointer ${c.cardRadiusXs} border border-white/10 ${compact ? 'py-1.5' : 'py-2'} font-mono ${c.label} tracking-[0.14em] text-white/80 hover:border-white/20`}>RESET</button>
          </div>

          {txHash && <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className={`mt-3 block break-all ${c.cardRadiusXs} border border-[#C5A67C]/20 bg-[#C5A67C]/10 p-2.5 font-mono ${compact ? 'text-[9.5px]' : 'text-[10px]'} text-[#C5A67C] underline underline-offset-2`}>{txHash}</a>}

          <DevDetails>
            {mode === 'arc-native'
              ? <div>Technical path: x402 exact · EIP-3009 transferWithAuthorization · network {NETWORK} · X-PAYMENT header · server-side verify+settle inline · nonce replay protection.</div>
              : <div>Technical path: GatewayWalletBatched · PAYMENT-SIGNATURE header · server-side BatchFacilitator inline verify+settle · consume-once replay ledger.</div>}
          </DevDetails>
        </div>
      </aside>
    </div>
  );
}
