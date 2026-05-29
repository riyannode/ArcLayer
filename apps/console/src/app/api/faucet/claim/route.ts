/**
 * POST /api/faucet/claim — Send 1 test USDC to the requesting wallet.
 *
 * Rate limits:
 *   - Wallet: 1 claim / 24 hours
 *   - IP:     1 claim / 24 hours
 *   - Global: 30 claims / 24 hours
 *   - User balance must be < FAUCET_MIN_USER_BALANCE_USDC
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { createPublicClient, createWalletClient, formatUnits, getAddress, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export const runtime = 'nodejs';

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = 'https://rpc.drpc.testnet.arc.network';
const USDC = getAddress('0x3600000000000000000000000000000000000000');
const CIRCLE_FAUCET_URL = 'https://faucet.circle.com/';

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

const arcTestnet = {
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
} as const;

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
}

function hashIp(ip: string): string {
  const salt = process.env.FAUCET_IP_SALT || 'arclayer-faucet-default-salt';
  return createHmac('sha256', salt).update(ip).digest('hex').slice(0, 16);
}

export async function POST(req: NextRequest) {
  try {
    // ─── Gate: faucet enabled ───
    if (process.env.FAUCET_ENABLED !== 'true') {
      return NextResponse.json({ ok: false, error: 'faucet_disabled', circleFaucetUrl: CIRCLE_FAUCET_URL }, { status: 503 });
    }

    const privateKey = process.env.FAUCET_PRIVATE_KEY as `0x${string}` | undefined;
    if (!privateKey) {
      return NextResponse.json({ ok: false, error: 'faucet_not_configured', circleFaucetUrl: CIRCLE_FAUCET_URL }, { status: 500 });
    }

    // ─── Parse + validate address ───
    const body = await req.json().catch(() => null);
    if (!body?.address) {
      return NextResponse.json({ ok: false, error: 'missing_address' }, { status: 400 });
    }

    let recipient: `0x${string}`;
    try {
      recipient = getAddress(body.address);
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_address' }, { status: 400 });
    }

    const ip = getClientIp(req);
    const ipHash = hashIp(ip);
    const supabase = getSupabaseAdmin();

    // ─── Rate limit: wallet (1 claim / 24 hours) ───
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: walletRecentCount } = await supabase
      .from('faucet_claims')
      .select('id', { count: 'exact', head: true })
      .ilike('wallet_address', recipient)
      .gte('created_at', twentyFourHoursAgo);

    if ((walletRecentCount ?? 0) > 0) {
      return NextResponse.json({ ok: false, error: 'rate_limited_wallet', retryAfterSeconds: 86400 }, { status: 429 });
    }

    // ─── Rate limit: IP (1 claim / 24 hours) ───
    const { count: ipRecentCount } = await supabase
      .from('faucet_claims')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', twentyFourHoursAgo);

    if ((ipRecentCount ?? 0) >= 1) {
      return NextResponse.json({ ok: false, error: 'rate_limited_ip', retryAfterSeconds: 86400 }, { status: 429 });
    }

    // ─── Rate limit: global (max claims / 24 hours) ───
    const maxDaily = Number(process.env.FAUCET_MAX_DAILY_CLAIMS ?? '30');
    const { count: globalDailyCount } = await supabase
      .from('faucet_claims')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', twentyFourHoursAgo);

    if ((globalDailyCount ?? 0) >= maxDaily) {
      return NextResponse.json({ ok: false, error: 'rate_limited_global', retryAfterSeconds: 3600 }, { status: 429 });
    }

    // ─── On-chain checks ───
    const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) });
    const amount = parseUnits(process.env.FAUCET_AMOUNT_USDC ?? '1', 6);
    const minUserBalance = parseUnits(process.env.FAUCET_MIN_USER_BALANCE_USDC ?? '0.01', 6);

    const [userBalance, treasuryBalance] = await Promise.all([
      publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [recipient] }),
      publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [privateKeyToAccount(privateKey).address] }),
    ]);

    if (userBalance >= minUserBalance) {
      return NextResponse.json({
        ok: false,
        error: 'wallet_already_funded',
        balance: formatUnits(userBalance, 6),
      }, { status: 409 });
    }

    if (treasuryBalance < amount) {
      return NextResponse.json({
        ok: false,
        error: 'treasury_empty',
        treasury: privateKeyToAccount(privateKey).address,
        circleFaucetUrl: CIRCLE_FAUCET_URL,
      }, { status: 503 });
    }

    // ─── Send USDC ───
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC) });

    const txHash = await walletClient.writeContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [recipient, amount],
    });

    // ─── Record claim ───
    await supabase.from('faucet_claims').insert({
      wallet_address: recipient,
      ip_hash: ipHash,
      amount_usdc: Number(process.env.FAUCET_AMOUNT_USDC ?? '1'),
      tx_hash: txHash,
      status: 'sent',
    });

    return NextResponse.json({
      ok: true,
      txHash,
      amount: process.env.FAUCET_AMOUNT_USDC ?? '1',
      explorerUrl: `https://testnet.arcscan.app/tx/${txHash}`,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      circleFaucetUrl: CIRCLE_FAUCET_URL,
    }, { status: 500 });
  }
}
