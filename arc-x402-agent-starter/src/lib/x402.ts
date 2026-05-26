import { getAddress } from 'viem';

const NETWORK = 'eip155:5042002';
const USDC = getAddress(process.env.NEXT_PUBLIC_USDC_ADDRESS || '0x3600000000000000000000000000000000000000');

export function getPayTo() {
  return getAddress(process.env.X402_RECEIVER_ADDRESS || process.env.X402_PAY_TO || '0x000000000000000000000000000000000000dEaD');
}

export function buildX402Challenge(resource: string, amount: string) {
  return {
    x402Version: 2,
    error: 'payment_required',
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK,
        asset: USDC,
        amount,
        payTo: getPayTo(),
        maxTimeoutSeconds: 600,
        extra: { name: 'USDC', version: '2', decimals: 6, symbol: 'USDC' },
      },
    ],
    resource,
  };
}

export function readPaymentHeader(req: Request) {
  return req.headers.get('X-PAYMENT') || req.headers.get('x-payment');
}
