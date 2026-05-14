type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type X402Accept = {
  scheme: 'arclayer-escrow' | 'exact';
  network: 'eip155:5042002';
  chainId: 5042002;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  mimeType?: string;
  extra?: {
    jobId?: string;
  };
};

export type PaymentRequiredPayload = {
  x402Version: 1;
  accepts: X402Accept[];
};

export type PaymentResponsePayload = {
  success: boolean;
  transaction: `0x${string}`;
  network: 'eip155:5042002';
  payer: `0x${string}`;
  amount: string;
  jobId: string;
  resource: string;
};

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function encodePaymentHeader(value: JsonValue): string {
  return toBase64Url(JSON.stringify(value));
}

export function decodePaymentHeader<T>(value: string): T {
  return JSON.parse(fromBase64Url(value)) as T;
}

export function buildPaymentRequiredHeader(payload: PaymentRequiredPayload): string {
  return encodePaymentHeader(payload);
}

export function buildPaymentResponseHeader(payload: PaymentResponsePayload): string {
  return encodePaymentHeader(payload);
}
