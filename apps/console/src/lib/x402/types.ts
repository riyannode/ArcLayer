export type X402Scheme = 'arc-escrow' | 'arclayer-escrow' | 'exact';
export type X402Network = 'arc-testnet' | 'eip155:5042002';
export type X402RequirementStatus = 'active' | 'expired' | 'fulfilled' | 'cancelled';
export type X402PaymentStatus = 'verified' | 'settled' | 'consumed' | 'failed' | 'expired';
export type X402AttemptOperation = 'verify' | 'settle' | 'consume' | 'issue_requirement';
export type X402AttemptStatus = 'started' | 'succeeded' | 'failed' | 'replayed' | 'rejected';

export interface X402Requirement {
  id?: string;
  requirementId: string;
  protocol: 'x402';
  scheme: X402Scheme;
  network: X402Network;
  chainId: number;
  resource: string;
  resourceMethod: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  asset: string;
  amountRequired: string;
  amountDisplay?: string;
  currency: 'USDC';
  maxTimeoutSeconds: number;
  expiresAt: string;
  nonce: string;
  jobId?: string;
  agentId?: string;
  routePattern?: string;
  metadata: Record<string, unknown>;
  status: X402RequirementStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface X402Payment {
  id?: string;
  paymentId: string;
  requirementId: string;
  txHash: string;
  chainId: number;
  scheme: X402Scheme;
  network: X402Network;
  payer?: string;
  payTo: string;
  asset: string;
  amount: string;
  jobId: string;
  resource: string;
  blockNumber?: number;
  blockHash?: string;
  logIndex?: number;
  eventName: 'JobFunded';
  verificationPayload: Record<string, unknown>;
  settlementPayload: Record<string, unknown>;
  status: X402PaymentStatus;
  verifiedAt?: string;
  settledAt?: string;
  consumedAt?: string;
  expiresAt?: string;
  failureCode?: string;
  failureMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface X402ConsumeResult {
  ok: boolean;
  code:
    | 'CONSUMED'
    | 'ALREADY_CONSUMED'
    | 'PAYMENT_NOT_FOUND'
    | 'TX_HASH_MISMATCH'
    | 'REQUIREMENT_MISMATCH'
    | 'RESOURCE_MISMATCH'
    | 'PAYMENT_REPLAY_DIFFERENT_RESOURCE'
    | 'PAYMENT_NOT_VERIFIED'
    | 'PAYMENT_EXPIRED'
    | 'RPC_ERROR';
  paymentId?: string;
  consumptionId?: string;
  message: string;
}

export interface X402CachedResponse {
  cacheKey: string;
  paymentId: string;
  consumptionId: string;
  requirementId: string;
  resource: string;
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody?: unknown;
  bodyText?: string;
  contentType?: string;
  expiresAt: string;
}

export interface X402PaymentAttemptInput {
  attemptId: string;
  paymentId?: string;
  requirementId?: string;
  txHash?: string;
  operation: X402AttemptOperation;
  status: X402AttemptStatus;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface X402Store {
  createRequirement(req: X402Requirement): Promise<X402Requirement>;
  getRequirement(requirementId: string): Promise<X402Requirement | null>;
  expireRequirement(requirementId: string): Promise<void>;
  markRequirementFulfilled(requirementId: string): Promise<void>;

  createPayment(payment: X402Payment): Promise<X402Payment>;
  getPaymentById(paymentId: string): Promise<X402Payment | null>;
  getPaymentByTxHash(txHash: string): Promise<X402Payment | null>;
  updatePaymentStatus(input: {
    paymentId: string;
    status: X402PaymentStatus;
    settlementPayload?: Record<string, unknown>;
    failureCode?: string;
    failureMessage?: string;
  }): Promise<X402Payment>;

  recordAttempt(attempt: X402PaymentAttemptInput): Promise<void>;

  consumePayment(input: {
    paymentId: string;
    txHash: string;
    requirementId: string;
    resource: string;
    resourceMethod: string;
    consumerKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<X402ConsumeResult>;

  getCachedResponse(cacheKey: string): Promise<X402CachedResponse | null>;
  putCachedResponse(response: X402CachedResponse): Promise<X402CachedResponse>;
}
