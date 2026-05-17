'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCircleWallet } from '@/hooks/useCircleWallet';
import { useAccount, useDisconnect } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { createPublicClient, formatUnits, getAddress, http, type Hex } from 'viem';
import { DevDetails } from '@/components/DevDetails';
import { InlineProtectionNotice, NOTICE_INSUFFICIENT_USDC, NOTICE_PAYMENT_REQUIRED, NOTICE_PAYMENT_SETTLED, NOTICE_PAYMENT_VERIFIED, NOTICE_REPLAY_FAILED, NOTICE_REPLAY_REJECTED, NOTICE_RESOURCE_UNLOCKED, NOTICE_WALLET_NOT_CONNECTED, NOTICE_WRONG_CHAIN, useProtectionNotice } from '@/components/protection';
import { shortenAddress } from '@/lib/contracts';

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = 'https://rpc.testnet.arc.network';
const USDC = getAddress('0x3600000000000000000000000000000000000000');
export const dynamic = 'force-dynamic';

const NETWORK = 'eip155:5042002';
const FALLBACK_PAY_TO = getAddress('0x3DC78013A70d9E0d1047902f5DCB50aeF68B003b');

const BALANCE_ABI = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;

type PaymentMode = 'arc-native' | 'circle-gateway';
type WalletMode = 'passkey' | 'eoa';
type Step = 'idle' | 'challenge' | 'signing' | 'verifying' | 'settling' | 'retrying' | 'replay' | 'done' | 'error';
type LogType = 'info' | 'success' | 'error' | 'warn';

interface LogLine { ts: string; msg: string; type: LogType }
interface RelayerStatus { ready: boolean; relayerAddress: string | null; usdcBalance: string; settleMode?: string; error?: string }
interface Requirement { scheme: 'exact'; network: string; asset: `0x${string}`; amount: string; payTo: `0x${string}`; maxTimeoutSeconds: number; extra?: Record<string, unknown> }
interface GatewayProbe { supported: boolean; network?: string; gatewayWallet?: string; error?: string }
interface GatewayBalance { depositedUsdc: string | null; poolUsdc?: string; method: string; note?: string; error?: string }

function nowTs() { return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function randomNonce(): Hex { return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex; }
function b64(value: unknown) { return btoa(JSON.stringify(value)); }

export default function X402DemoPage() {
  const { ready, authenticated, login, register, address: circleAddress, smartAccount } = useCircleWallet();
  const { address: eoaAddress, isConnected: eoaConnected } = useAccount();
  const { disconnect: eoaDisconnect } = useDisconnect();
  const { open: openAppKit } = useAppKit();
  const { notify } = useProtectionNotice();
  const [walletMode, setWalletMode] = useState<WalletMode>('passkey');
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

  // Resolve active wallet based on mode
  const activeAddress = useMemo(() => {
    if (walletMode === 'eoa') return eoaAddress as `0x${string}` | undefined;
    return (circleAddress as `0x${string}`) || undefined;
  }, [walletMode, eoaAddress, circleAddress]);
  const activeReady = walletMode === 'eoa' ? true : ready;
  const activeAuthed = walletMode === 'eoa' ? eoaConnected : authenticated;
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
        // Map gateway-status response shape to GatewayProbe shape used by UI.
        // gateway-status returns { ok, readiness, gateway: { ok, network, gatewayWallet, error }, ... }
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

  // Fetch Gateway balance when wallet address is available
  useEffect(() => {
    if (!address) { setGatewayBalance(null); return; }
    fetch(`/api/x402/gateway-balance?address=${address}`)
      .then((r) => r.json())
      .then((data: GatewayBalance) => setGatewayBalance(data))
      .catch((e) => setGatewayBalance({ depositedUsdc: null, method: 'error', error: e instanceof Error ? e.message : String(e) }));
  }, [address]);

  // Auto-suggest mode based on Gateway deposit balance
  useEffect(() => {
    if (!gatewayBalance) return;
    const deposited = gatewayBalance.depositedUsdc;
    if (deposited && Number(deposited) >= 0.05) {
      // User has Gateway deposit — suggest Gateway mode
      setMode('circle-gateway');
    }
    // else: stay on default arc-native
  }, [gatewayBalance]);

  const reset = useCallback(() => {
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
    log('1/9 Requesting protected resource without payment...');
    const first = await fetch('/api/x402-demo/protected');
    const challenge = await first.json();
    if (first.status !== 402 || !challenge.paymentRequirements) { log('Protected endpoint did not return x402 402 challenge', 'error'); setStep('error'); return; }
    const req = challenge.paymentRequirements as Requirement;
    setRequirement(req);
    log(`2/9 Received 402 Payment Required: ${formatUnits(BigInt(req.amount), 6)} USDC`, 'success');
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

    log('3/9 Signing EIP-3009 transferWithAuthorization...');
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

    const body = { x402Version: 2, paymentPayload, paymentRequirements: req };

    setStep('verifying');
    log('4/9 Verifying canonical exact payment...');
    const verify = await fetch('/api/x402/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const verifyJson = await verify.json();
    if (!verifyJson.isValid) { log(`Verify failed: ${verifyJson.invalidReason || verifyJson.error} — ${verifyJson.invalidMessage || ''}`, 'error'); setStep('error'); return; }
    log(`Verified signer: ${shortenAddress(verifyJson.payer)}`, 'success');
    notify(NOTICE_PAYMENT_VERIFIED);

    setStep('settling');
    log('5/9 Settling USDC on-chain through relayer...');
    const settle = await fetch('/api/x402/settle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const settleJson = await settle.json();
    if (!settleJson.success) { log(`Settle failed: ${settleJson.errorReason || settleJson.error} — ${settleJson.errorMessage || ''}`, 'error'); setStep('error'); return; }
    setTxHash(settleJson.transaction);
    log(`6/9 Settled on Arc: ${settleJson.transaction.slice(0, 18)}...`, 'success');
    notify({
      ...NOTICE_PAYMENT_SETTLED,
      title: `−${formatUnits(BigInt(req.amount), 6)} USDC settled`,
      message: `On-chain settlement confirmed. Your wallet was charged ${formatUnits(BigInt(req.amount), 6)} USDC via EIP-3009.`,
      technicalDetail: `tx: ${settleJson.transaction}`,
    });

    setStep('retrying');
    log('7/9 Retrying protected resource with canonical X-PAYMENT header...');
    const header = b64(paymentPayload);
    const unlockedResp = await fetch('/api/x402-demo/protected', { headers: { 'X-PAYMENT': header } });
    const unlockedJson = await unlockedResp.json();
    if (!unlockedResp.ok || !unlockedJson.unlocked) { log(`Protected retry failed: ${unlockedJson.error || unlockedResp.status}`, 'error'); setStep('error'); return; }
    setUnlocked(true);
    log('8/9 Protected resource unlocked with settlement proof.', 'success');
    notify(NOTICE_RESOURCE_UNLOCKED);

    setStep('replay');
    log('9/9 Replay test: reusing the same nonce against /api/x402/verify...');
    const replay = await fetch('/api/x402/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const replayJson = await replay.json();
    const rejected = replayJson.isValid === false && replayJson.invalidReason === 'nonce_used';
    setReplayResult(rejected ? 'Rejected: nonce_used' : `Unexpected: ${JSON.stringify(replayJson).slice(0, 80)}`);
    log(rejected ? 'Replay rejected: nonce_used ✓' : 'Replay test did not return expected nonce_used', rejected ? 'success' : 'error');
    if (rejected) {
      notify({ ...NOTICE_REPLAY_REJECTED, technicalDetail: 'Replay rejected: nonce_used', message: 'This Arc Native EIP-3009 nonce was already consumed and cannot unlock the protected resource again.' });
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
    log('[GW] 1/7 Requesting protected resource without payment...');
    const first = await fetch('/api/x402-demo/protected');
    const challenge = await first.json();
    if (first.status !== 402 || !challenge.accepts) { log('Protected endpoint did not return x402 402 challenge', 'error'); setStep('error'); return; }

    // Find Gateway payment option
    const accepts = challenge.accepts as Requirement[];
    const gwOption = accepts.find((a) => a.extra?.name === 'GatewayWalletBatched');
    if (!gwOption) { log('No GatewayWalletBatched option in 402 response. Gateway may not be enabled.', 'error'); setStep('error'); return; }
    setRequirement(gwOption);
    log(`[GW] 2/7 Found Gateway option: ${formatUnits(BigInt(gwOption.amount), 6)} USDC via ${gwOption.extra?.name}`, 'success');

    const client = createPublicClient({ transport: http(ARC_RPC) });
    const balance = await client.readContract({ address: USDC, abi: BALANCE_ABI, functionName: 'balanceOf', args: [address] });
    log(`Payer USDC balance: ${formatUnits(balance, 6)} USDC`);
    if (balance < BigInt(gwOption.amount)) {
      log(`Insufficient USDC. Need ${formatUnits(BigInt(gwOption.amount), 6)} USDC.`, 'error');
      notify(NOTICE_INSUFFICIENT_USDC);
      setStep('error'); return;
    }

    setStep('signing');
    // Circle Gateway requires authorization validity >= 604900s (7 days + 100s buffer).
    // See @circle-fin/x402-batching: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS = 7d + 100s.
    const validBefore = String(Math.floor(Date.now() / 1000) + 604900);
    const nonce = randomNonce();
    // Gateway EIP-712 domain: use extra fields from 402 response (name, version, verifyingContract)
    // Circle SDK expects: name='GatewayWalletBatched', version='1', verifyingContract=GatewayWallet
    const gwDomainName = String(gwOption.extra?.name || 'GatewayWalletBatched');
    const gwDomainVersion = String(gwOption.extra?.version || '1');
    const gwVerifyingContract = getAddress(String(gwOption.extra?.verifyingContract || USDC));

    const paymentPayload = {
      x402Version: 2,
      resource: `${window.location.origin}/api/x402-demo/protected`,
      accepted: { ...gwOption, asset: getAddress(gwOption.asset), payTo: getAddress(gwOption.payTo), extra: { ...gwOption.extra, name: 'GatewayWalletBatched' } },
      payload: {
        signature: '0x' as Hex,
        authorization: { from: address, to: getAddress(gwOption.payTo), value: gwOption.amount, validAfter: '0', validBefore, nonce },
      },
    };

    log('[GW] 3/7 Signing EIP-3009 for Gateway batching...');
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

    const body = { x402Version: 2, paymentPayload, paymentRequirements: gwOption };

    setStep('verifying');
    log('[GW] 4/7 Verifying via BatchFacilitatorClient...');
    const verify = await fetch('/api/x402/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const verifyJson = await verify.json();
    if (!verifyJson.isValid) { log(`Gateway verify failed: ${verifyJson.invalidReason || verifyJson.error}`, 'error'); setStep('error'); return; }
    log(`[GW] Verified payer: ${shortenAddress(verifyJson.payer)}`, 'success');
    notify(NOTICE_PAYMENT_VERIFIED);

    setStep('settling');
    log('[GW] 5/7 Settling via Circle Gateway (may be async/batched)...');
    const settle = await fetch('/api/x402/settle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const settleJson = await settle.json();
    if (!settleJson.success) { log(`Gateway settle failed: ${settleJson.errorReason || settleJson.error}`, 'error'); setStep('error'); return; }
    const isPending = settleJson.extra?.status === 'accepted_pending_settlement';
    if (isPending) {
      log('[GW] Settlement accepted (pending batch finalization)', 'warn');
    } else {
      setTxHash(settleJson.transaction || '');
      log(`[GW] 6/7 Settled: ${settleJson.transaction?.slice(0, 18) || 'batched'}...`, 'success');
    }
    notify({
      ...NOTICE_PAYMENT_SETTLED,
      title: `−${formatUnits(BigInt(gwOption.amount), 6)} USDC settled`,
      message: `Circle Gateway settlement confirmed. Your wallet was charged ${formatUnits(BigInt(gwOption.amount), 6)} USDC via EIP-3009.`,
      technicalDetail: settleJson.transaction ? `tx: ${settleJson.transaction}` : 'batched (pending finalization)',
    });

    setStep('retrying');
    log('[GW] 6/7 Retrying protected resource with PAYMENT-SIGNATURE header...');
    const header = b64(paymentPayload);
    const unlockedResp = await fetch('/api/x402-demo/protected', { headers: { 'PAYMENT-SIGNATURE': header, 'X-PAYMENT': header } });
    const unlockedJson = await unlockedResp.json();
    if (!unlockedResp.ok || !unlockedJson.unlocked) { log(`Protected retry failed: ${unlockedJson.error || unlockedResp.status}`, 'error'); setStep('error'); return; }
    setUnlocked(true);
    log('[GW] 7/7 Protected resource unlocked via Circle Gateway.', 'success');
    notify(NOTICE_RESOURCE_UNLOCKED);

    // Gateway replay test: reuse same PAYMENT-SIGNATURE
    setStep('replay');
    log('[GW] 8/8 Replay test: reusing same PAYMENT-SIGNATURE...');
    const replayResp = await fetch('/api/x402-demo/protected', { headers: { 'PAYMENT-SIGNATURE': header, 'X-PAYMENT': header } });
    const replayJson = await replayResp.json();
    const replayRejected = !replayResp.ok || replayJson.error === 'gateway_payment_replayed' || replayJson.error === 'nonce_used' || replayJson.error === 'payment_already_used';
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

  /* ─── MAIN RUNNER ─── */
  const runDemo = useCallback(async () => {
    reset();
    if (!activeAuthed || !address) {
      log('No wallet connected', 'error');
      notify({ ...NOTICE_WALLET_NOT_CONNECTED, surface: 'toast', autoCloseMs: 4_500 });
      setStep('error'); return;
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

    if (mode === 'arc-native') {
      await runArcNative(wallet as unknown as Parameters<typeof runArcNative>[0]);
    } else {
      await runGateway(wallet as unknown as Parameters<typeof runGateway>[0]);
    }
  }, [activeAuthed, address, walletMode, smartAccount, log, reset, mode, runArcNative, runGateway, notify]);

  const connectEoa = useCallback(() => {
    openAppKit();
  }, [openAppKit]);

  const connectCircle = useCallback(() => {
    register('arclayer-x402').catch((e) => log(`Circle passkey failed: ${e instanceof Error ? e.message : String(e)}`, 'error'));
  }, [register, log]);

  const loginCircle = useCallback(() => {
    login().catch((e) => log(`Circle sign-in failed: ${e instanceof Error ? e.message : String(e)}`, 'error'));
  }, [login, log]);


  const busy = !['idle', 'done', 'error'].includes(step);
  const payTo = requirement?.payTo || relayer?.relayerAddress || FALLBACK_PAY_TO;

  return (
    <main className="min-h-screen bg-[#080808] px-4 py-6 text-[#EAE4D8] md:px-6 md:py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-col gap-3 border-b border-white/10 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-[0.24em] text-[#C5A67C]">ARCLAYER x402 MARKET</div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white md:text-5xl">Pay per API call</h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-white/55">
            <span className={activeAuthed ? 'h-2 w-2 rounded-full bg-green-400' : 'h-2 w-2 rounded-full bg-yellow-400'} />
            {activeAuthed && address ? `${walletMode === 'eoa' ? 'EOA' : 'PASSKEY'} · ${shortenAddress(address)}` : 'Wallet not connected'}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <section className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-[#111]/80 p-5 shadow-2xl shadow-black/30">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 font-mono text-[10px] tracking-[0.2em] text-white/35">PROTECTED RESOURCE</div>
                  <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">Will this API unlock after x402 payment?</h2>
                  <p className="mt-2 font-mono text-[12px] text-white/45">/api/x402-demo/protected</p>
                </div>
                <div className="rounded-full bg-green-500/15 px-3 py-1 font-mono text-[10px] text-green-300">LIVE</div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                  <div className="font-mono text-[10px] text-white/35">PRICE</div>
                  <div className="mt-1 text-2xl font-semibold text-white">0.01 USDC</div>
                  <div className="mt-1 text-xs text-white/40">per resource unlock</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                  <div className="font-mono text-[10px] text-white/35">RELAYER</div>
                  <div className={relayer?.ready ? 'mt-1 text-2xl font-semibold text-green-300' : 'mt-1 text-2xl font-semibold text-red-300'}>{relayer?.ready ? 'Ready' : 'Offline'}</div>
                  <div className="mt-1 text-xs text-white/40">{relayer?.relayerAddress ? shortenAddress(relayer.relayerAddress) : 'not configured'}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                  <div className="font-mono text-[10px] text-white/35">GATEWAY</div>
                  <div className={gatewayProbe?.supported ? 'mt-1 text-2xl font-semibold text-green-300' : 'mt-1 text-2xl font-semibold text-yellow-300'}>{gatewayProbe?.supported ? 'Supported' : 'Checking'}</div>
                  <div className="mt-1 text-xs text-white/40">{gatewayProbe?.gatewayWallet ? shortenAddress(gatewayProbe.gatewayWallet) : 'arcTestnet'}</div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <button onClick={() => setMode('arc-native')} className={`cursor-pointer rounded-2xl border p-5 text-left transition-all ${mode === 'arc-native' ? 'border-[#C5A67C]/70 bg-[#C5A67C]/10 shadow-lg shadow-[#C5A67C]/10' : 'border-white/10 bg-white/[0.025] hover:border-white/25'}`}>
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.18em] text-[#C5A67C]">ARC NATIVE</span>
                  <span className="rounded-full bg-green-500/15 px-2 py-1 font-mono text-[9px] text-green-300">RECOMMENDED</span>
                </div>
                <div className="text-xl font-semibold text-white">EOA pay-per-call</div>
                <p className="mt-2 text-sm leading-6 text-white/50">No deposit. Sign one EIP-3009 authorization and settle USDC directly on Arc.</p>
                <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-[11px]">
                  <div className="rounded-lg bg-black/25 p-3"><div className="text-white/35">Deposit</div><div className="text-green-300">Not required</div></div>
                  <div className="rounded-lg bg-black/25 p-3"><div className="text-white/35">Best for</div><div className="text-white/70">Occasional calls</div></div>
                </div>
              </button>

              <button onClick={() => setMode('circle-gateway')} className={`cursor-pointer rounded-2xl border p-5 text-left transition-all ${mode === 'circle-gateway' ? 'border-[#7CB5C5]/70 bg-[#7CB5C5]/10 shadow-lg shadow-[#7CB5C5]/10' : 'border-white/10 bg-white/[0.025] hover:border-white/25'}`}>
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.18em] text-[#7CB5C5]">CIRCLE GATEWAY</span>
                  <span className="rounded-full bg-white/10 px-2 py-1 font-mono text-[9px] text-white/55">POWER USER</span>
                </div>
                <div className="text-xl font-semibold text-white">Pre-funded execution</div>
                <p className="mt-2 text-sm leading-6 text-white/50">Deposit once, then execute high-frequency agent payments through Gateway batching.</p>
                <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-[11px]">
                  <div className="rounded-lg bg-black/25 p-3"><div className="text-white/35">Your deposit</div><div className={gatewayBalance?.depositedUsdc && Number(gatewayBalance.depositedUsdc) > 0 ? 'text-green-300' : 'text-yellow-300'}>{gatewayBalance?.depositedUsdc ?? '0'} USDC</div></div>
                  <div className="rounded-lg bg-black/25 p-3"><div className="text-white/35">Best for</div><div className="text-white/70">HFT agents</div></div>
                </div>
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
              <div className="mb-3 font-mono text-[10px] tracking-[0.2em] text-white/35">EXECUTION LOG</div>
              {logs.length > 0 ? (
                <div className="max-h-[340px] overflow-y-auto font-mono text-[10.5px] leading-[1.9]">
                  {logs.map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 text-white/20">{l.ts}</span>
                      <span className={l.type === 'success' ? 'text-green-400/80' : l.type === 'error' ? 'text-red-400/80' : l.type === 'warn' ? 'text-yellow-400/80' : 'text-white/55'}>{l.msg}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="font-mono text-[11px] text-white/35">No execution yet. Connect wallet and run the payment ticket.</div>
              )}
            </div>
          </section>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-white/10 bg-[#111]/95 p-5 shadow-2xl shadow-black/40">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold tracking-[-0.03em] text-white">Payment ticket</h3>
                <span className={mode === 'arc-native' ? 'rounded-full bg-[#C5A67C]/15 px-2 py-1 font-mono text-[9px] text-[#C5A67C]' : 'rounded-full bg-[#7CB5C5]/15 px-2 py-1 font-mono text-[9px] text-[#7CB5C5]'}>{mode === 'arc-native' ? 'ARC' : 'GATEWAY'}</span>
              </div>

              <div className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 bg-black/25 p-1">
                <button onClick={() => setMode('arc-native')} className={`cursor-pointer rounded-lg py-2 font-mono text-[11px] ${mode === 'arc-native' ? 'bg-[#C5A67C] text-black' : 'text-white/45'}`}>ARC</button>
                <button onClick={() => setMode('circle-gateway')} className={`cursor-pointer rounded-lg py-2 font-mono text-[11px] ${mode === 'circle-gateway' ? 'bg-[#7CB5C5] text-black' : 'text-white/45'}`}>GATEWAY</button>
              </div>

              <div className="space-y-3 border-y border-white/10 py-4 font-mono text-[12px]">
                <div className="flex justify-between gap-4"><span className="text-white/40">Cost</span><span className="text-white">0.01 USDC</span></div>
                <div className="flex justify-between gap-4"><span className="text-white/40">Pay to</span><span className="text-white">{shortenAddress(payTo)}</span></div>
                <div className="flex justify-between gap-4"><span className="text-white/40">Network</span><span className="text-white">Arc Testnet</span></div>
                <div className="flex justify-between gap-4"><span className="text-white/40">Current step</span><span className={mode === 'arc-native' ? 'text-[#C5A67C]' : 'text-[#7CB5C5]'}>{step.toUpperCase()}</span></div>
                <div className="flex justify-between gap-4"><span className="text-white/40">Unlocked</span><span className={unlocked ? 'text-green-300' : 'text-white/45'}>{unlocked ? 'YES' : 'NO'}</span></div>
                <div className="flex justify-between gap-4"><span className="text-white/40">Replay guard</span><span className={replayResult.startsWith('Rejected') ? 'text-green-300' : 'text-white/45'}>{replayResult}</span></div>
              </div>

              {mode === 'circle-gateway' && (!gatewayBalance?.depositedUsdc || Number(gatewayBalance.depositedUsdc) <= 0) && (
                <div className="mt-4 rounded-xl border border-yellow-400/20 bg-yellow-400/10 p-3 font-mono text-[11px] leading-5 text-yellow-100/80">
                  Gateway balance is empty for this EOA. Deposit USDC into GatewayWallet first, or use Arc Native for no-deposit execution.
                </div>
              )}

              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 bg-black/25 p-1">
                  <button onClick={() => setWalletMode('passkey')} className={`cursor-pointer rounded-lg py-2 font-mono text-[10px] tracking-[0.16em] ${walletMode === 'passkey' ? 'bg-white text-black' : 'text-white/45'}`}>PASSKEY</button>
                  <button onClick={() => setWalletMode('eoa')} className={`cursor-pointer rounded-lg py-2 font-mono text-[10px] tracking-[0.16em] ${walletMode === 'eoa' ? 'bg-white text-black' : 'text-white/45'}`}>EOA WALLET</button>
                </div>

                {walletMode === 'passkey' ? (
                  !ready ? (
                    <div className="font-mono text-[10px] text-white/30">LOADING CIRCLE WALLET...</div>
                  ) : !authenticated ? (
                    <>
                      <InlineProtectionNotice {...NOTICE_WALLET_NOT_CONNECTED} title="Sign in with passkey" message="Create or restore a Circle Modular Wallet using your device passkey." className="mb-1" />
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={connectCircle} className="cursor-pointer rounded-xl border border-[#C5A67C]/40 py-3 font-mono text-[11px] tracking-[0.14em] text-[#C5A67C]">CREATE</button>
                        <button onClick={loginCircle} className="cursor-pointer rounded-xl border border-white/20 py-3 font-mono text-[11px] tracking-[0.14em] text-white/70">SIGN IN</button>
                      </div>
                    </>
                  ) : (
                    <button onClick={busy ? undefined : runDemo} disabled={busy || relayer?.ready === false} className={`w-full cursor-pointer rounded-xl border py-3 font-mono text-[11px] tracking-[0.14em] transition-all disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/30 ${mode === 'arc-native' ? 'border-[#C5A67C]/50 bg-[#C5A67C] text-[#050505] hover:bg-[#d5b78a]' : 'border-[#7CB5C5]/50 bg-[#7CB5C5] text-[#050505] hover:bg-[#91cadb]'}`}>
                      {busy ? `RUNNING: ${step.toUpperCase()}` : step === 'done' ? 'RUN AGAIN' : `BUY ACCESS`}
                    </button>
                  )
                ) : (
                  !eoaConnected ? (
                    <>
                      <InlineProtectionNotice {...NOTICE_WALLET_NOT_CONNECTED} title="Connect EOA wallet" message="Open Reown AppKit to connect MetaMask, Coinbase, WalletConnect, or any browser wallet." className="mb-1" />
                      <button onClick={connectEoa} className="w-full cursor-pointer rounded-xl border border-white/20 bg-white/[0.06] py-3 font-mono text-[11px] tracking-[0.14em] text-white hover:bg-white/[0.12]">CONNECT EOA WALLET</button>
                    </>
                  ) : (
                    <>
                      <button onClick={busy ? undefined : runDemo} disabled={busy || relayer?.ready === false} className={`w-full cursor-pointer rounded-xl border py-3 font-mono text-[11px] tracking-[0.14em] transition-all disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/30 ${mode === 'arc-native' ? 'border-[#C5A67C]/50 bg-[#C5A67C] text-[#050505] hover:bg-[#d5b78a]' : 'border-[#7CB5C5]/50 bg-[#7CB5C5] text-[#050505] hover:bg-[#91cadb]'}`}>
                        {busy ? `RUNNING: ${step.toUpperCase()}` : step === 'done' ? 'RUN AGAIN' : `BUY ACCESS`}
                      </button>
                      <button onClick={() => eoaDisconnect()} className="mt-2 w-full cursor-pointer rounded-xl border border-white/10 py-2 font-mono text-[10px] tracking-[0.14em] text-white/40 hover:border-white/20">DISCONNECT EOA</button>
                    </>
                  )
                )}
                <button onClick={reset} className="mt-1 w-full cursor-pointer rounded-xl border border-white/10 py-2 font-mono text-[10px] tracking-[0.14em] text-white/40 hover:border-white/20">RESET</button>
              </div>

              {txHash && <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="mt-4 block break-all rounded-xl border border-[#C5A67C]/20 bg-[#C5A67C]/10 p-3 font-mono text-[10px] text-[#C5A67C] underline underline-offset-2">{txHash}</a>}

              <DevDetails>
                {mode === 'arc-native'
                  ? <div>Technical path: x402 exact · EIP-3009 transferWithAuthorization · network {NETWORK} · X-PAYMENT · self-hosted relayer · nonce replay protection.</div>
                  : <div>Technical path: GatewayWalletBatched · PAYMENT-SIGNATURE · BatchFacilitatorClient verify/settle · local paymentId replay ledger.</div>}
              </DevDetails>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
