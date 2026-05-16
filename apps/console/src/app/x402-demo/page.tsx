'use client';

import { useCallback, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { createPublicClient, http, formatUnits, getAddress, type Hex } from 'viem';
import { shortenAddress } from '@/lib/contracts';

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = 'https://rpc.testnet.arc.network';
const USDC = getAddress('0x3600000000000000000000000000000000000000');
const NETWORK = 'eip155:5042002';
const PAY_TO = getAddress('0x3DC78013A70d9E0d1047902f5DCB50aeF68B003b'); // relayer = recipient for demo

type Step = 'idle' | 'connecting' | 'signing' | 'verifying' | 'settling' | 'done' | 'error';

interface Log {
  ts: string;
  msg: string;
  type?: 'info' | 'success' | 'error';
}

function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function X402DemoPage() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [step, setStep] = useState<Step>('idle');
  const [logs, setLogs] = useState<Log[]>([]);
  const [txHash, setTxHash] = useState<string>('');
  const [amount, setAmount] = useState('0.01');

  const log = useCallback((msg: string, type: Log['type'] = 'info') => {
    setLogs((prev) => [...prev, { ts: ts(), msg, type }]);
  }, []);

  const reset = useCallback(() => {
    setStep('idle');
    setLogs([]);
    setTxHash('');
  }, []);

  const runDemo = useCallback(async () => {
    reset();
    setStep('connecting');

    const wallet = wallets[0];
    if (!wallet) {
      log('No wallet connected', 'error');
      setStep('error');
      return;
    }

    const address = wallet.address as `0x${string}`;
    log(`Wallet: ${shortenAddress(address)}`);

    // Switch to Arc if needed
    try {
      await wallet.switchChain(ARC_CHAIN_ID);
      log(`Chain: Arc Testnet (${ARC_CHAIN_ID})`);
    } catch {
      log('Failed to switch to Arc Testnet', 'error');
      setStep('error');
      return;
    }

    // Check balance
    const client = createPublicClient({ transport: http(ARC_RPC) });
    const balanceOfAbi = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;
    const balance = await client.readContract({ address: USDC, abi: balanceOfAbi, functionName: 'balanceOf', args: [address] });
    const balDisplay = formatUnits(balance, 6);
    log(`Balance: ${balDisplay} USDC`);

    const amountAtomic = BigInt(Math.round(parseFloat(amount) * 1_000_000));
    if (balance < amountAtomic) {
      log(`Insufficient balance. Need ${amount} USDC, have ${balDisplay}`, 'error');
      setStep('error');
      return;
    }

    // Build EIP-3009 authorization
    setStep('signing');
    log('Building EIP-3009 authorization...');

    const now = Math.floor(Date.now() / 1000);
    const validAfter = '0';
    const validBefore = String(now + 600);
    const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex;

    const domain = {
      name: 'USDC',
      version: '2',
      chainId: ARC_CHAIN_ID,
      verifyingContract: USDC,
    };

    const types = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    };

    const message = {
      from: address,
      to: PAY_TO,
      value: amountAtomic,
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    };

    let signature: Hex;
    try {
      const provider = await wallet.getEthereumProvider();
      const rawSig = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [
          address,
          JSON.stringify({
            types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], ...types },
            primaryType: 'TransferWithAuthorization',
            domain,
            message: {
              from: address,
              to: PAY_TO,
              value: `0x${amountAtomic.toString(16)}`,
              validAfter: '0x0',
              validBefore: `0x${BigInt(validBefore).toString(16)}`,
              nonce,
            },
          }),
        ],
      });
      signature = rawSig as Hex;
      log(`Signature: ${signature.slice(0, 20)}...`, 'success');
    } catch (e: unknown) {
      log(`User rejected signature: ${e instanceof Error ? e.message : String(e)}`, 'error');
      setStep('error');
      return;
    }

    // Verify
    setStep('verifying');
    log('Calling /api/x402/verify...');

    const payload = {
      x402Version: 2,
      paymentPayload: {
        x402Version: 2,
        accepted: {
          scheme: 'exact',
          network: NETWORK,
          asset: USDC,
          amount: amountAtomic.toString(),
          payTo: PAY_TO,
          maxTimeoutSeconds: 300,
          extra: { name: 'USDC', version: '2', decimals: 6 },
        },
        payload: {
          signature,
          authorization: {
            from: address,
            to: PAY_TO,
            value: amountAtomic.toString(),
            validAfter,
            validBefore,
            nonce,
          },
        },
      },
      paymentRequirements: {
        scheme: 'exact',
        network: NETWORK,
        asset: USDC,
        amount: amountAtomic.toString(),
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { name: 'USDC', version: '2', decimals: 6 },
      },
    };

    try {
      const verifyResp = await fetch('/api/x402/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const verifyJson = await verifyResp.json();

      if (!verifyJson.isValid) {
        log(`Verify failed: ${verifyJson.invalidReason} — ${verifyJson.invalidMessage}`, 'error');
        setStep('error');
        return;
      }
      log(`Verified ✓ payer=${shortenAddress(verifyJson.payer)}`, 'success');
    } catch (e: unknown) {
      log(`Verify request failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
      setStep('error');
      return;
    }

    // Settle
    setStep('settling');
    log('Calling /api/x402/settle (relayer submits on-chain)...');

    try {
      const settleResp = await fetch('/api/x402/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const settleJson = await settleResp.json();

      if (!settleJson.success) {
        log(`Settle failed: ${settleJson.errorReason} — ${settleJson.errorMessage}`, 'error');
        setStep('error');
        return;
      }

      setTxHash(settleJson.transaction);
      log(`Settled ✓ tx=${settleJson.transaction.slice(0, 18)}...`, 'success');
      log(`Amount: ${amount} USDC transferred via EIP-3009`, 'success');
      setStep('done');
    } catch (e: unknown) {
      log(`Settle request failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
      setStep('error');
    }
  }, [wallets, amount, log, reset]);

  return (
    <main className="min-h-screen bg-[#050505] text-[#EAE4D8] px-4 py-12 md:py-20">
      <div className="mx-auto max-w-[640px]">
        {/* Header */}
        <div className="mb-10">
          <h1 className="font-mono text-[11px] tracking-[0.2em] text-[#C5A67C] mb-2">
            x402 PROTOCOL DEMO
          </h1>
          <p className="font-mono text-[13px] text-white/60 leading-relaxed">
            Canonical x402 V2 payment on Arc Testnet. Sign an EIP-3009 authorization,
            verify the signature, and settle USDC on-chain via relayer — gasless for the payer.
          </p>
        </div>

        {/* Info card */}
        <div
          className="mb-8 p-4 font-mono text-[11px] leading-[1.8]"
          style={{ border: '1px solid rgba(197, 166, 124, 0.15)', background: 'rgba(197, 166, 124, 0.03)' }}
        >
          <div className="flex justify-between"><span className="text-white/40">Scheme</span><span>exact (EIP-3009)</span></div>
          <div className="flex justify-between"><span className="text-white/40">Network</span><span>eip155:5042002</span></div>
          <div className="flex justify-between"><span className="text-white/40">Asset</span><span>USDC (6 decimals)</span></div>
          <div className="flex justify-between"><span className="text-white/40">Recipient</span><span>{shortenAddress(PAY_TO)}</span></div>
          <div className="flex justify-between"><span className="text-white/40">Settlement</span><span>Relayer (gasless for payer)</span></div>
        </div>

        {/* Amount input */}
        <div className="mb-6">
          <label className="block font-mono text-[10px] tracking-[0.18em] text-white/40 mb-2">
            AMOUNT (USDC)
          </label>
          <input
            type="number"
            step="0.001"
            min="0.001"
            max="10"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={step !== 'idle' && step !== 'error' && step !== 'done'}
            className="w-full bg-transparent font-mono text-[14px] text-[#EAE4D8] px-3 py-2 outline-none"
            style={{ border: '1px solid rgba(197, 166, 124, 0.25)' }}
          />
        </div>

        {/* Action button */}
        <div className="mb-8">
          {!ready ? (
            <div className="font-mono text-[10px] text-white/30">LOADING PRIVY...</div>
          ) : !authenticated ? (
            <button
              onClick={login}
              className="w-full py-3 font-mono text-[11px] tracking-[0.18em] transition-all duration-300"
              style={{ border: '1px solid rgba(197, 166, 124, 0.4)', color: '#C5A67C' }}
            >
              CONNECT WALLET
            </button>
          ) : step === 'idle' || step === 'error' || step === 'done' ? (
            <button
              onClick={runDemo}
              className="w-full py-3 font-mono text-[11px] tracking-[0.18em] transition-all duration-300"
              style={{
                border: '1px solid rgba(197, 166, 124, 0.5)',
                color: '#050505',
                background: '#C5A67C',
              }}
            >
              {step === 'done' ? 'RUN AGAIN' : 'SIGN & SETTLE x402 PAYMENT'}
            </button>
          ) : (
            <div
              className="w-full py-3 text-center font-mono text-[11px] tracking-[0.18em] text-[#C5A67C]"
              style={{ border: '1px solid rgba(197, 166, 124, 0.2)' }}
            >
              {step === 'connecting' && 'CONNECTING...'}
              {step === 'signing' && 'WAITING FOR SIGNATURE...'}
              {step === 'verifying' && 'VERIFYING...'}
              {step === 'settling' && 'SETTLING ON-CHAIN...'}
            </div>
          )}
        </div>

        {/* Tx result */}
        {txHash && (
          <div
            className="mb-6 p-4 font-mono text-[11px]"
            style={{ border: '1px solid rgba(80, 200, 120, 0.3)', background: 'rgba(80, 200, 120, 0.04)' }}
          >
            <div className="text-[10px] tracking-[0.18em] text-green-400/70 mb-2">SETTLEMENT CONFIRMED</div>
            <a
              href={`https://testnet.arcscan.app/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#C5A67C] underline underline-offset-2 break-all"
            >
              {txHash}
            </a>
          </div>
        )}

        {/* Live logs */}
        {logs.length > 0 && (
          <div
            className="p-4 font-mono text-[10.5px] leading-[1.9] max-h-[320px] overflow-y-auto"
            style={{ border: '1px solid rgba(255, 255, 255, 0.06)', background: 'rgba(0,0,0,0.3)' }}
          >
            <div className="text-[9px] tracking-[0.2em] text-white/30 mb-2">EXECUTION LOG</div>
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-white/20 shrink-0">{l.ts}</span>
                <span className={
                  l.type === 'success' ? 'text-green-400/80' :
                  l.type === 'error' ? 'text-red-400/80' :
                  'text-white/50'
                }>
                  {l.msg}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 font-mono text-[9.5px] text-white/20 leading-relaxed">
          <p>x402 V2 · scheme: exact · EIP-3009 transferWithAuthorization</p>
          <p>Payer signs off-chain → relayer submits on-chain → USDC settled</p>
          <p className="mt-1">Arc Testnet · chainId 5042002 · USDC 0x3600...0000</p>
        </div>
      </div>
    </main>
  );
}
