import { humanJson } from '@/lib/api/human-json';
/**
 * GET /api/faucet/status — Check if the ArcLayer faucet treasury has funds.
 * No auth required. Returns ready state + fallback Circle Faucet URL.
 */
import { NextRequest } from 'next/server';
import { createPublicClient, formatUnits, getAddress, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { safeErrorForLog } from '@/lib/sanitize-error';

export const runtime = 'nodejs';

const ARC_RPC = 'https://rpc.drpc.testnet.arc.network';
const USDC = getAddress('0x3600000000000000000000000000000000000000');
const CIRCLE_FAUCET_URL = 'https://faucet.circle.com/';

const ERC20_BALANCE_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export async function GET(req: NextRequest) {
  try {
    if (process.env.FAUCET_ENABLED !== 'true') {
      return humanJson(req, { ready: false, reason: 'faucet_disabled', circleFaucetUrl: CIRCLE_FAUCET_URL });
    }

    const privateKey = process.env.FAUCET_PRIVATE_KEY as `0x${string}` | undefined;
    if (!privateKey) {
      return humanJson(req, { ready: false, reason: 'faucet_not_configured', circleFaucetUrl: CIRCLE_FAUCET_URL });
    }

    const account = privateKeyToAccount(privateKey);
    const publicClient = createPublicClient({ transport: http(ARC_RPC) });

    const treasuryBalance = await publicClient.readContract({
      address: USDC,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });

    const claimAmount = parseUnits(process.env.FAUCET_AMOUNT_USDC ?? '1', 6);
    const ready = treasuryBalance >= claimAmount;

    return humanJson(req, {
      ready,
      reason: ready ? 'ok' : 'treasury_empty',
      treasury: account.address,
      treasuryBalanceUsdc: formatUnits(treasuryBalance, 6),
      claimAmountUsdc: process.env.FAUCET_AMOUNT_USDC ?? '1',
      minUserBalanceUsdc: process.env.FAUCET_MIN_USER_BALANCE_USDC ?? '0.01',
      circleFaucetUrl: CIRCLE_FAUCET_URL,
    });
  } catch (err) {
    console.error(`[faucet/status] status check failed: ${safeErrorForLog(err)}`);
    return humanJson(req, {
      ready: false,
      reason: 'status_check_failed',
      error: 'internal_error',
      circleFaucetUrl: CIRCLE_FAUCET_URL,
    }, { status: 500 });
  }
}
