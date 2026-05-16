/**
 * x402 Client — handles the 402 payment flow for agent-to-agent commerce.
 * Uses viem for signing but with relaxed type assertions to avoid strict generics.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  encodePacked,
  keccak256,
  parseUnits,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { PaymentRequirements, X402PaymentPayload } from './types.js';

export const arcTestnet: Chain = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.arc.circle.com'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://testnet-explorer.arc.circle.com' },
  },
};

const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
const USDC_DECIMALS = 6;

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const ERC20_ABI = [
  { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'version', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'balanceOf', inputs: [{ type: 'address', name: 'account' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

export class X402Client {
  private account;
  private wallet;
  private publicClient;

  constructor(privateKey: `0x${string}`) {
    this.account = privateKeyToAccount(privateKey);
    this.wallet = createWalletClient({
      account: this.account,
      chain: arcTestnet,
      transport: http(),
    });
    this.publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(),
    });
  }

  get address() {
    return this.account.address;
  }

  /**
   * Full x402 flow: request -> 402 -> sign -> retry -> resource
   */
  async payAndAccess<T>(url: string): Promise<{ data: T; paymentTxHash?: string }> {
    // Step 1: Initial request
    const res = await fetch(url);

    if (res.status === 200) {
      return { data: (await res.json()) as T };
    }

    if (res.status !== 402) {
      throw new Error(`Unexpected status ${res.status}: ${await res.text()}`);
    }

    // Step 2: Parse payment requirements
    const body: any = await res.json();
    const requirements: PaymentRequirements = body.paymentRequirements ?? body;

    // Step 3: Sign EIP-3009
    const payload = await this.signPayment(requirements);

    // Step 4: Retry with X-PAYMENT
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const retry = await fetch(url, {
      headers: { 'X-PAYMENT': encoded },
    });

    if (!retry.ok) {
      const err = await retry.text();
      throw new Error(`Payment retry failed (${retry.status}): ${err}`);
    }

    // Extract tx hash
    const paymentResponse = retry.headers.get('payment-response');
    let paymentTxHash: string | undefined;
    if (paymentResponse) {
      try {
        const decoded = JSON.parse(Buffer.from(paymentResponse, 'base64url').toString());
        paymentTxHash = decoded.txHash ?? decoded.transaction;
      } catch {}
    }

    return { data: (await retry.json()) as T, paymentTxHash };
  }

  private async signPayment(requirements: PaymentRequirements): Promise<X402PaymentPayload> {
    const value = parseUnits(requirements.amount, USDC_DECIMALS);
    const validAfter = 0;
    const validBefore = Math.floor(Date.now() / 1000) + (requirements.maxTimeoutSeconds || 300);
    const nonce = keccak256(
      encodePacked(['address', 'uint256'], [this.account.address, BigInt(Date.now())])
    );

    // Read USDC domain
    const name = await this.publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'name',
    });
    const version = await this.publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'version',
    });

    const domain = {
      name: name as string,
      version: version as string,
      chainId: arcTestnet.id,
      verifyingContract: USDC_ADDRESS,
    };

    const message = {
      from: this.account.address,
      to: requirements.payTo as `0x${string}`,
      value,
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce: nonce as `0x${string}`,
    };

    const signature = await this.wallet.signTypedData({
      account: this.account,
      domain,
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    });

    return {
      x402Version: 1,
      scheme: 'exact',
      network: 'eip155:5042002',
      payload: {
        signature,
        authorization: {
          from: this.account.address,
          to: requirements.payTo as `0x${string}`,
          value: value.toString(),
          validAfter,
          validBefore,
          nonce,
        },
      },
    };
  }

  async getBalance(): Promise<bigint> {
    const balance = await this.publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [this.account.address],
    });
    return balance as bigint;
  }
}
