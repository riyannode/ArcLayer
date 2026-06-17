/**
 * Shared wallet execution interface.
 * Both CircleCliAdapter and CircleDevWalletAdapter implement this.
 * ExecutionGateway and RunnerServices depend on this interface only.
 */

/** Normalized result from any wallet adapter write. */
export type WalletExecuteResult = {
  /** CLI command or API method that was called. */
  command: string;
  /** Redacted arguments (CLI) or request summary (API). */
  args: string[];
  /** Standard output or JSON response body. */
  stdout: string;
  /** Standard error or empty for API adapters. */
  stderr: string;
  /** Parsed JSON from stdout/body, if available. */
  json?: unknown;
};

export interface WalletExecutionAdapter {
  /** Adapter version or CLI version. */
  version?(): Promise<WalletExecuteResult>;

  /** Wallet status / health check. */
  walletStatus(): Promise<WalletExecuteResult>;

  /** Token balance for an address on a chain. */
  walletBalance(
    address: string,
    chain: string,
    signal?: AbortSignal,
  ): Promise<WalletExecuteResult>;

  /** Wallet budget (if supported). */
  walletBudget?(
    address: string,
    signal?: AbortSignal,
  ): Promise<WalletExecuteResult>;

  /** Gateway balance (if supported). */
  gatewayBalance?(
    address: string,
    chain: string,
    signal?: AbortSignal,
  ): Promise<WalletExecuteResult>;

  /** Inspect an x402 service (read-only). */
  inspectService?(input: {
    url: string;
    method?: string;
    body?: unknown;
    headers?: string[];
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult>;

  /** Pay an x402 service. */
  payService?(input: {
    url: string;
    address: string;
    chain: string;
    maxAmountUsdc: string;
    method?: string;
    body?: unknown;
    headers?: string[];
    timeoutSeconds?: number;
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult>;

  /** Execute an allowlisted ERC-8183 contract write. */
  executeErc8183Write(input: {
    signature:
      | "submit(uint256,bytes32,bytes)"
      | "createJob(address,address,uint256,string,address)"
      | "setBudget(uint256,uint256,bytes)"
      | "fund(uint256,bytes)"
      | "complete(uint256,bytes32,bytes)"
      | "reject(uint256,bytes32,bytes)"
      | "claimRefund(uint256)"
      | "setProvider(uint256,address)";
    params: string[];
    contract: string;
    address: string;
    chain: string;
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult>;

  /** Approve USDC spending (ERC-20 approve). */
  approveUsdc(input: {
    amount: string;
    usdcAddress: string;
    spenderAddress: string;
    walletAddress: string;
    chain: string;
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult>;

  /** Execute an allowlisted Arc write (submit, register). */
  executeAllowedArcWrite?(input: {
    signature: "submit(uint256,bytes32,bytes)" | "register(string)";
    params: string[];
    contract: string;
    address: string;
    chain: string;
    allowRegister?: boolean;
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult>;

  /** Query a smart contract (read-only). */
  queryContract?(input: {
    signature: string;
    params: string[];
    contract: string;
    chain: string;
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult>;

  /** Deposit USDC into Circle Gateway. */
  gatewayDeposit?(input: {
    amount: string;
    address: string;
    chain: string;
    method?: string;
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult>;
}
