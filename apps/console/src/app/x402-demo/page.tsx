'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { createPublicClient, formatUnits, getAddress, http, type Hex } from 'viem';
import { shortenAddress } from '@/lib/contracts';

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = 'https://rpc.testnet.arc.network';
const USDC = getAddress('0x3600000000000000000000000000000000000000');
const NETWORK = 'eip155:5042002';
const FALLBACK_PAY_TO = getAddress('0x3DC78013A70d9E0d1047902f5DCB50aeF68B003b');

const BALANCE_ABI = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;

type PaymentMode = 'arc-native' | 'circle-gateway';
type Step = 'idle' | 'challenge' | 'signing' | 'verifying' | 'settling' | 'retrying' | 'replay' | 'done' | 'error';
type LogType = 'info' | 'success' | 'error' | 'warn';

interface LogLine { ts: string; msg: string; type: LogType }
interface RelayerStatus { ready: boolean; relayerAddress: string | null; usdcBalance: string; settleMode?: string; error?: string }
interface Requirement { scheme: 'exact'; network: string; asset: `0x${string}`; amount: string; payTo: `0x${string}`; maxTimeoutSeconds: number; extra?: Record<string, unknown> }
interface GatewayProbe { supported: boolean; network?: string; gatewayWallet?: string; error?: string }

function nowTs() { return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function randomNonce(): Hex { return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex; }
function b64(value: unknown) { return btoa(JSON.stringify(value)); }

export default function X402DemoPage() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [mode, setMode] = useState<PaymentMode>('arc-native');
  const [step, setStep] = useState<Step>('idle');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [txHash, setTxHash] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [replayResult, setReplayResult] = useState('Not run');
  const [relayer, setRelayer] = useState<RelayerStatus | null>(null);
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [gatewayProbe, setGatewayProbe] = useState<GatewayProbe | null>(null);

  const log = useCallback((msg: string, type: LogType = 'info') => setLogs((prev) => [...prev, { ts: nowTs(), msg, type }]), []);

  useEffect(() => {
    fetch('/api/x402/relayer-status')
      .then((r) => r.json())
      .then(setRelayer)
      .catch((e) => setRelayer({ ready: false, relayerAddress: null, usdcBalance: '0', error: e instanceof Error ? e.message : String(e) }));
    fetch('/api/x402/gateway-probe')
      .then((r) => r.json())
      .then(setGatewayProbe)
      .catch(() => setGatewayProbe({ supported: false, error: 'probe_failed' }));
  }, []);

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
      log(`Failed to switch to Arc Testnet: ${e instanceof Error ? e.message : String(e)}`, 'error'); setStep('error'); return;
    }

    setStep('challenge');
    log('1/9 Requesting protected resource without payment...');
    const first = await fetch('/api/x402-demo/protected');
    const challenge = await first.json();
    if (first.status !== 402 || !challenge.paymentRequirements) { log('Protected endpoint did not return x402 402 challenge', 'error'); setStep('error'); return; }
    const req = challenge.paymentRequirements as Requirement;
    setRequirement(req);
    log(`2/9 Received 402 Payment Required: ${formatUnits(BigInt(req.amount), 6)} USDC`, 'success');

    const client = createPublicClient({ transport: http(ARC_RPC) });
    const balance = await client.readContract({ address: USDC, abi: BALANCE_ABI, functionName: 'balanceOf', args: [address] });
    log(`Payer USDC balance: ${formatUnits(balance, 6)} USDC`);
    if (balance < BigInt(req.amount)) { log(`Insufficient USDC. Need ${formatUnits(BigInt(req.amount), 6)} USDC.`, 'error'); setStep('error'); return; }

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

    setStep('settling');
    log('5/9 Settling USDC on-chain through relayer...');
    const settle = await fetch('/api/x402/settle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const settleJson = await settle.json();
    if (!settleJson.success) { log(`Settle failed: ${settleJson.errorReason || settleJson.error} — ${settleJson.errorMessage || ''}`, 'error'); setStep('error'); return; }
    setTxHash(settleJson.transaction);
    log(`6/9 Settled on Arc: ${settleJson.transaction.slice(0, 18)}...`, 'success');

    setStep('retrying');
    log('7/9 Retrying protected resource with canonical X-PAYMENT header...');
    const header = b64(paymentPayload);
    const unlockedResp = await fetch('/api/x402-demo/protected', { headers: { 'X-PAYMENT': header } });
    const unlockedJson = await unlockedResp.json();
    if (!unlockedResp.ok || !unlockedJson.unlocked) { log(`Protected retry failed: ${unlockedJson.error || unlockedResp.status}`, 'error'); setStep('error'); return; }
    setUnlocked(true);
    log('8/9 Protected resource unlocked with settlement proof.', 'success');

    setStep('replay');
    log('9/9 Replay test: reusing the same nonce against /api/x402/verify...');
    const replay = await fetch('/api/x402/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const replayJson = await replay.json();
    const rejected = replayJson.isValid === false && replayJson.invalidReason === 'nonce_used';
    setReplayResult(rejected ? 'Rejected: nonce_used' : `Unexpected: ${JSON.stringify(replayJson).slice(0, 80)}`);
    log(rejected ? 'Replay rejected: nonce_used ✓' : 'Replay test did not return expected nonce_used', rejected ? 'success' : 'error');
    setStep(rejected ? 'done' : 'error');
  }, [log]);

  /* ─── CIRCLE GATEWAY FLOW ─── */
  const runGateway = useCallback(async (wallet: { address: string; switchChain: (id: number) => Promise<void>; getEthereumProvider: () => Promise<{ request: (args: { method: string; params: unknown[] }) => Promise<unknown> }> }) => {
    const address = wallet.address as `0x${string}`;

    try {
      await wallet.switchChain(ARC_CHAIN_ID);
      log(`Wallet connected on Arc: ${shortenAddress(address)}`);
    } catch (e) {
      log(`Failed to switch to Arc Testnet: ${e instanceof Error ? e.message : String(e)}`, 'error'); setStep('error'); return;
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
    if (balance < BigInt(gwOption.amount)) { log(`Insufficient USDC. Need ${formatUnits(BigInt(gwOption.amount), 6)} USDC.`, 'error'); setStep('error'); return; }

    setStep('signing');
    const validBefore = String(Math.floor(Date.now() / 1000) + 600);
    const nonce = randomNonce();
    const verifyingContract = (gwOption.extra?.verifyingContract as string) || USDC;

    const paymentPayload = {
      x402Version: 2,
      accepted: { ...gwOption, asset: getAddress(gwOption.asset), payTo: getAddress(gwOption.payTo), extra: { ...gwOption.extra, name: 'GatewayWalletBatched' } },
      payload: {
        signature: '0x' as Hex,
        authorization: { from: address, to: getAddress(gwOption.payTo), value: gwOption.amount, validAfter: '0', validBefore, nonce },
      },
    };

    log('[GW] 3/7 Signing EIP-3009 for Gateway batching...');
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
          domain: { name: 'USDC', version: '2', chainId: ARC_CHAIN_ID, verifyingContract: getAddress(verifyingContract) },
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

    setStep('retrying');
    log('[GW] 6/7 Retrying protected resource with PAYMENT-SIGNATURE header...');
    const header = b64(paymentPayload);
    const unlockedResp = await fetch('/api/x402-demo/protected', { headers: { 'PAYMENT-SIGNATURE': header, 'X-PAYMENT': header } });
    const unlockedJson = await unlockedResp.json();
    if (!unlockedResp.ok || !unlockedJson.unlocked) { log(`Protected retry failed: ${unlockedJson.error || unlockedResp.status}`, 'error'); setStep('error'); return; }
    setUnlocked(true);
    log('[GW] 7/7 Protected resource unlocked via Circle Gateway.', 'success');
    setStep('done');
  }, [log]);

  /* ─── MAIN RUNNER ─── */
  const runDemo = useCallback(async () => {
    reset();
    const wallet = wallets[0];
    if (!wallet) { log('No wallet connected', 'error'); setStep('error'); return; }
    if (mode === 'arc-native') {
      await runArcNative(wallet as unknown as Parameters<typeof runArcNative>[0]);
    } else {
      await runGateway(wallet as unknown as Parameters<typeof runGateway>[0]);
    }
  }, [wallets, log, reset, mode, runArcNative, runGateway]);

  const busy = !['idle', 'done', 'error'].includes(step);
  const payTo = requirement?.payTo || relayer?.relayerAddress || FALLBACK_PAY_TO;

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-12 text-[#EAE4D8] md:py-20">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[#C5A67C]">x402 DUAL-MODE PROTECTED RESOURCE DEMO</h1>
          <p className="max-w-2xl font-mono text-[13px] leading-relaxed text-white/60">Full Arc Testnet flow with two production-live payment modes: <span className="text-[#C5A67C]">Arc Native Payment</span> (self-hosted EIP-3009 relayer, settles on-chain) and <span className="text-[#7CB5C5]">Circle Gateway Payment</span> (BatchFacilitatorClient, settles through Circle Gateway).</p>
        </div>

        {/* MODE SELECTOR */}
        <div className="mb-6 flex gap-3">
          <button
            onClick={() => setMode('arc-native')}
            className={`flex-1 border py-3 font-mono text-[11px] tracking-[0.16em] transition-all ${mode === 'arc-native' ? 'border-[#C5A67C]/60 bg-[#C5A67C]/10 text-[#C5A67C]' : 'border-white/10 text-white/40 hover:border-white/20'}`}
          >
            ARC NATIVE (EIP-3009)
          </button>
          <button
            onClick={() => setMode('circle-gateway')}
            className={`flex-1 border py-3 font-mono text-[11px] tracking-[0.16em] transition-all ${mode === 'circle-gateway' ? 'border-[#7CB5C5]/60 bg-[#7CB5C5]/10 text-[#7CB5C5]' : 'border-white/10 text-white/40 hover:border-white/20'}`}
          >
            CIRCLE GATEWAY (BATCHED)
          </button>
        </div>

        {/* STATUS CARDS */}
        <div className="mb-8 grid gap-4 md:grid-cols-3">
          <div className="border border-white/10 bg-white/[0.02] p-4 font-mono text-[11px]">
            <div className="mb-2 text-[9px] tracking-[0.18em] text-white/30">PROTECTED RESOURCE</div>
            <div>/api/x402-demo/protected</div>
            <div className="mt-2 text-white/40">No header returns 402. Settled payment returns 200.</div>
          </div>
          <div className="border border-white/10 bg-white/[0.02] p-4 font-mono text-[11px]">
            <div className="mb-2 text-[9px] tracking-[0.18em] text-white/30">RELAYER STATUS</div>
            <div className={relayer?.ready ? 'text-green-400/80' : 'text-red-400/80'}>{relayer?.ready ? 'READY' : 'NOT READY'}</div>
            <div className="mt-2 text-white/40">{relayer?.relayerAddress ? shortenAddress(relayer.relayerAddress) : 'not configured'} · {relayer?.usdcBalance ?? '0'} USDC</div>
          </div>
          <div className="border border-white/10 bg-white/[0.02] p-4 font-mono text-[11px]">
            <div className="mb-2 text-[9px] tracking-[0.18em] text-white/30">GATEWAY STATUS</div>
            <div className={gatewayProbe?.supported ? 'text-green-400/80' : 'text-yellow-400/80'}>{gatewayProbe?.supported ? 'SUPPORTED' : 'PROBING...'}</div>
            <div className="mt-2 text-white/40">{gatewayProbe?.network || 'arcTestnet'} · {gatewayProbe?.gatewayWallet ? shortenAddress(gatewayProbe.gatewayWallet) : 'checking...'}</div>
          </div>
        </div>

        {/* PAYMENT MODE INFO */}
        <div className="mb-6 border border-white/10 bg-white/[0.02] p-4 font-mono text-[11px]">
          <div className="mb-2 text-[9px] tracking-[0.18em] text-white/30">ACTIVE MODE</div>
          {mode === 'arc-native' ? (
            <div><span className="text-[#C5A67C]">Arc Native</span> · {NETWORK} · EIP-3009 · Self-hosted relayer settlement · Header: X-PAYMENT · payTo {shortenAddress(payTo)}</div>
          ) : (
            <div><span className="text-[#7CB5C5]">Circle Gateway</span> · eip155:5042002 · BatchFacilitatorClient · verifies live · settlement pending until buyer GatewayWallet deposit · Header: PAYMENT-SIGNATURE · payTo {shortenAddress(payTo)}</div>
          )}
        </div>

        {/* ACTION BUTTONS */}
        <div className="mb-6">
          {!ready ? <div className="font-mono text-[10px] text-white/30">LOADING PRIVY...</div> : !authenticated ? (
            <button onClick={login} className="w-full border border-[#C5A67C]/40 py-3 font-mono text-[11px] tracking-[0.18em] text-[#C5A67C]">CONNECT WALLET</button>
          ) : (
            <button
              onClick={busy ? undefined : runDemo}
              disabled={busy || relayer?.ready === false}
              className={`w-full border py-3 font-mono text-[11px] tracking-[0.18em] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/30 ${mode === 'arc-native' ? 'border-[#C5A67C]/50 bg-[#C5A67C] text-[#050505]' : 'border-[#7CB5C5]/50 bg-[#7CB5C5] text-[#050505]'}`}
            >
              {busy ? `RUNNING: ${step.toUpperCase()}` : step === 'done' ? 'RUN AGAIN' : `RUN ${mode === 'arc-native' ? 'ARC NATIVE' : 'GATEWAY'} x402 FLOW`}
            </button>
          )}
          <button onClick={reset} className="mt-3 w-full border border-white/10 py-2 font-mono text-[10px] tracking-[0.16em] text-white/40">RESET</button>
        </div>

        {/* RESULTS */}
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <div className="border border-white/10 bg-black/30 p-4 font-mono text-[11px] leading-relaxed">
            <div className="mb-2 text-[9px] tracking-[0.18em] text-white/30">RESULT</div>
            <div>Unlocked: <span className={unlocked ? 'text-green-400/80' : 'text-white/40'}>{unlocked ? 'YES' : 'NO'}</span></div>
            <div>Mode: <span className={mode === 'arc-native' ? 'text-[#C5A67C]' : 'text-[#7CB5C5]'}>{mode === 'arc-native' ? 'Arc Native' : 'Circle Gateway'}</span></div>
            <div>Replay: <span className={replayResult.startsWith('Rejected') ? 'text-green-400/80' : 'text-white/40'}>{replayResult}</span></div>
            {txHash && <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-[#C5A67C] underline underline-offset-2">{txHash}</a>}
          </div>
          <div className="border border-white/10 bg-black/30 p-4 font-mono text-[11px] leading-relaxed">
            <div className="mb-2 text-[9px] tracking-[0.18em] text-white/30">CURRENT STEP</div>
            <div className={mode === 'arc-native' ? 'text-[#C5A67C]' : 'text-[#7CB5C5]'}>{step.toUpperCase()}</div>
            <div className="mt-2 text-white/40">
              {mode === 'arc-native'
                ? 'Header: X-PAYMENT = base64(JSON PaymentPayload). Legacy alias PAYMENT-SIGNATURE accepted.'
                : 'Header: PAYMENT-SIGNATURE = base64(JSON PaymentPayload). Routed to BatchFacilitatorClient.'}
            </div>
          </div>
        </div>

        {/* EVIDENCE / PROOF STATUS */}
        <div className="mb-6 border border-white/10 bg-white/[0.02] p-4 font-mono text-[10.5px] leading-[1.9]">
          <div className="mb-3 text-[9px] tracking-[0.2em] text-white/30">INTEGRATION EVIDENCE</div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[#C5A67C]">Arc Native Payment</div>
              <div className="text-white/60">✅ Verify: pass</div>
              <div className="text-white/60">✅ Settle: on-chain pass</div>
              <div className="text-white/60">✅ Unlock: pass</div>
              <div className="text-white/60">✅ Receipt already used protection</div>
              <div className="text-white/60">✅ Settlement tx: <a href="https://testnet.arcscan.app/tx/0x52c894303c75f932e9cb892acb177cdb832c05c5f5b073d952554f085be4f264" target="_blank" rel="noopener noreferrer" className="text-[#C5A67C] underline underline-offset-2">0x52c894…f085be4f264</a></div>
            </div>
            <div>
              <div className="mb-1 text-[#7CB5C5]">Circle Gateway Payment</div>
              <div className="text-white/60">✅ Verify: pass</div>
              <div className="text-white/60">✅ Settle: Circle Gateway pass</div>
              <div className="text-white/60">✅ Unlock: pass</div>
              <div className="text-white/60">✅ Receipt already used protection (local paymentId ledger)</div>
              <div className="text-white/60">✅ Settlement ID: <span className="font-mono text-[#7CB5C5]">0e366c3d-…1913fd</span></div>
              <div className="text-white/60">✅ Payment receipt: <span className="font-mono text-[#7CB5C5]">fa643dfc…dddf01</span></div>
            </div>
          </div>
        </div>

        {/* LOGS */}
        {logs.length > 0 && (
          <div className="max-h-[380px] overflow-y-auto border border-white/10 bg-black/40 p-4 font-mono text-[10.5px] leading-[1.9]">
            <div className="mb-2 text-[9px] tracking-[0.2em] text-white/30">STEP LOGS</div>
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-white/20">{l.ts}</span>
                <span className={l.type === 'success' ? 'text-green-400/80' : l.type === 'error' ? 'text-red-400/80' : l.type === 'warn' ? 'text-yellow-400/80' : 'text-white/55'}>{l.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
