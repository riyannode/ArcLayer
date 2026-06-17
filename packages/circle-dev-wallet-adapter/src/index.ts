/**
 * Circle Developer-Controlled Wallet Adapter.
 * Implements WalletExecutionAdapter using Circle's Dev-Controlled Wallet API/SDK.
 *
 * Security: never logs API key, entity secret, walletId, walletSetId, or bearer tokens.
 */
import { randomUUID } from "node:crypto";
import { RunnerError } from "@arclayer/runner-core";
import type {
  WalletExecutionAdapter,
  WalletExecuteResult,
} from "@arclayer/runner-core";
import {
  initiateDeveloperControlledWalletsClient,
  type CircleDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";
import { createPublicClient, http } from "viem";

// ── Types ──────────────────────────────────────────────────────────────

export type CircleDevWalletOptions = {
  apiKey: string;
  entitySecret: string;
  walletId: string;
  walletSetId?: string;
  walletAddress: string;
  chain: string;
  baseUrl?: string;
};

// ── Redaction ──────────────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /apiKey[:\s]*[^\s,}]+/gi,
  /entitySecret[:\s]*[^\s,}]+/gi,
  /entitySecretCiphertext[:\s]*[^\s,}]+/gi,
  /walletId[:\s]*[^\s,}]+/gi,
  /walletSetId[:\s]*[^\s,}]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /private[_-]?key[:\s]*[^\s,}]+/gi,
];

function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const colonIdx = match.indexOf(":");
      if (colonIdx >= 0) {
        return match.slice(0, colonIdx + 1) + " [REDACTED]";
      }
      return "[REDACTED]";
    });
  }
  return result;
}

function sanitizeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return redactSecrets(msg);
}

// ── ERC-8183 Signature Allowlist ───────────────────────────────────────

const ERC8183_SIGNATURES = new Set([
  "submit(uint256,bytes32,bytes)",
  "createJob(address,address,uint256,string,address)",
  "setBudget(uint256,uint256,bytes)",
  "fund(uint256,bytes)",
  "complete(uint256,bytes32,bytes)",
  "reject(uint256,bytes32,bytes)",
  "claimRefund(uint256)",
  "setProvider(uint256,address)",
]);

// ── Chain Mapping ──────────────────────────────────────────────────────

function mapChain(chain: string): string {
  const normalized = chain.trim().toUpperCase();
  if (
    normalized === "ARC-TESTNET" ||
    normalized === "ARC" ||
    normalized === "ARCTESTNET" ||
    normalized === "5042002"
  ) {
    return "ARC-TESTNET";
  }
  return normalized;
}

// ── Arc Testnet for viem reads ─────────────────────────────────────────

const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
} as const;

// ── Adapter ────────────────────────────────────────────────────────────

export class CircleDevWalletAdapter implements WalletExecutionAdapter {
  private readonly apiKey: string;
  private readonly entitySecret: string;
  private readonly walletId: string;
  private readonly walletAddress: string;
  private readonly chain: string;
  private readonly baseUrl?: string;

  /** Lazily-initialized Circle SDK client. */
  private client: CircleDeveloperControlledWalletsClient | null = null;

  constructor(options: CircleDevWalletOptions) {
    if (!options.apiKey) {
      throw new RunnerError(
        "CONFIG_ERROR",
        "circleApiKey is required for circle-dev wallet rail",
        500,
      );
    }
    if (!options.entitySecret) {
      throw new RunnerError(
        "CONFIG_ERROR",
        "circleEntitySecret is required for circle-dev wallet rail",
        500,
      );
    }
    if (!options.walletId) {
      throw new RunnerError(
        "CONFIG_ERROR",
        "circleWalletId is required for circle-dev wallet rail",
        500,
      );
    }
    if (!options.walletAddress) {
      throw new RunnerError(
        "CONFIG_ERROR",
        "circleWalletAddress is required for circle-dev wallet rail",
        500,
      );
    }

    this.apiKey = options.apiKey;
    this.entitySecret = options.entitySecret;
    this.walletId = options.walletId;
    this.walletAddress = options.walletAddress;
    this.chain = mapChain(options.chain);
    this.baseUrl = options.baseUrl;
  }

  /**
   * Get or create the Circle SDK client.
   * The SDK auto-generates entitySecretCiphertext per request.
   */
  private getClient(): CircleDeveloperControlledWalletsClient {
    if (this.client) return this.client;

    this.client = initiateDeveloperControlledWalletsClient({
      apiKey: this.apiKey,
      entitySecret: this.entitySecret,
    });

    return this.client;
  }

  /** Build a normalized WalletExecuteResult from SDK response. */
  private buildResult(
    command: string,
    json: unknown,
    extra?: { stdout?: string; stderr?: string },
  ): WalletExecuteResult {
    return {
      command,
      args: [],
      stdout: extra?.stdout ?? JSON.stringify(json ?? {}),
      stderr: extra?.stderr ?? "",
      json,
    };
  }

  /** Generate a UUID v4 idempotency key. */
  private newIdempotencyKey(): string {
    return randomUUID();
  }

  /**
   * Poll transaction until terminal state.
   * Returns the final transaction object.
   */
  private async waitForTransaction(
    transactionId: string,
    maxWaitMs = 120_000,
  ): Promise<Record<string, unknown>> {
    const client = this.getClient();
    const deadline = Date.now() + maxWaitMs;
    const TERMINAL = new Set([
      "COMPLETE",
      "FAILED",
      "DENIED",
      "CANCELLED",
    ]);

    while (Date.now() < deadline) {
      const resp = await client.getTransaction({ id: transactionId });
      const tx = resp.data?.transaction as Record<string, unknown> | undefined;
      if (!tx) break;

      const state = String(tx.state ?? "").toUpperCase();
      if (TERMINAL.has(state)) return tx;

      // Wait before next poll
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Return whatever we have — caller classifies
    return { id: transactionId, state: "UNKNOWN_TIMEOUT" };
  }

  // ── Version & Status ──────────────────────────────────────────────────

  async version(): Promise<WalletExecuteResult> {
    return this.buildResult("circle-dev-wallet-adapter", {
      version: "0.1.0",
      adapter: "circle-dev",
    });
  }

  async walletStatus(): Promise<WalletExecuteResult> {
    try {
      const client = this.getClient();
      const resp = await client.getWallet({ id: this.walletId });
      return this.buildResult("wallet.status", {
        ok: true,
        walletId: "[REDACTED]",
        state: (resp.data as any)?.wallet?.state,
        chain: this.chain,
      });
    } catch (error) {
      return this.buildResult("wallet.status", {
        ok: false,
        error: sanitizeError(error),
      });
    }
  }

  // ── Balance ───────────────────────────────────────────────────────────

  async walletBalance(
    address: string,
    chain: string,
    _signal?: AbortSignal,
  ): Promise<WalletExecuteResult> {
    try {
      const client = this.getClient();
      const resp = await client.getWalletTokenBalance({
        id: this.walletId,
      });
      const balances = resp.data?.tokenBalances ?? [];
      return this.buildResult("wallet.balance", {
        ok: true,
        address,
        chain: mapChain(chain),
        balances,
      });
    } catch (error) {
      throw new RunnerError(
        "CIRCLE_API_ERROR",
        `walletBalance failed: ${sanitizeError(error)}`,
        502,
      );
    }
  }

  // ── Contract Execution (ERC-8183 writes) ──────────────────────────────

  async executeErc8183Write(input: {
    signature: string;
    params: string[];
    contract: string;
    address: string;
    chain: string;
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult> {
    if (!ERC8183_SIGNATURES.has(input.signature)) {
      throw new RunnerError(
        "ERC8183_SIGNATURE_BLOCKED",
        `Signature "${input.signature}" is not in the ERC-8183 lifecycle allowlist`,
        403,
      );
    }

    return this.executeContractTransaction(
      input.contract,
      input.signature,
      input.params,
      `erc8183.${input.signature.split("(")[0]}`,
    );
  }

  async approveUsdc(input: {
    amount: string;
    usdcAddress: string;
    spenderAddress: string;
    walletAddress: string;
    chain: string;
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult> {
    return this.executeContractTransaction(
      input.usdcAddress,
      "approve(address,uint256)",
      [input.spenderAddress, input.amount],
      "erc20.approve",
    );
  }

  async executeAllowedArcWrite(input: {
    signature: "submit(uint256,bytes32,bytes)" | "register(string)";
    params: string[];
    contract: string;
    address: string;
    chain: string;
    allowRegister?: boolean;
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult> {
    if (input.signature === "register(string)" && !input.allowRegister) {
      throw new RunnerError(
        "ERC8004_REGISTER_BLOCKED",
        "ERC-8004 register execution is blocked by default; use prepare-register unless explicitly allowed",
        403,
      );
    }

    if (
      input.signature !== "submit(uint256,bytes32,bytes)" &&
      input.signature !== "register(string)"
    ) {
      throw new RunnerError(
        "ARC_CONTRACT_METHOD_BLOCKED",
        "Only allowlisted ArcLayer contract methods are allowed",
        403,
      );
    }

    return this.executeContractTransaction(
      input.contract,
      input.signature,
      input.params,
      `arc.${input.signature.split("(")[0]}`,
    );
  }

  /**
   * Core contract execution via Circle SDK.
   * Creates transaction, polls until terminal state, returns normalized result.
   */
  private async executeContractTransaction(
    contractAddress: string,
    abiFunctionSignature: string,
    abiParameters: string[],
    label: string,
  ): Promise<WalletExecuteResult> {
    try {
      const client = this.getClient();

      const resp = await client.createContractExecutionTransaction({
        walletId: this.walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters,
        fee: {
          type: "level",
          config: { feeLevel: "MEDIUM" },
        },
        idempotencyKey: this.newIdempotencyKey(),
      });

      const transactionId = resp.data?.id as string | undefined;
      if (!transactionId) {
        return this.buildResult(label, {
          ok: false,
          error: "No transaction ID returned from Circle API",
          raw: resp.data,
        });
      }

      // Poll until terminal state
      const tx = await this.waitForTransaction(transactionId);
      const state = String(tx.state ?? "").toUpperCase();
      const txHash = tx.txHash as string | undefined;

      return this.buildResult(label, {
        ok: state === "COMPLETE",
        data: {
          id: transactionId,
          state,
          txHash,
        },
      });
    } catch (error) {
      throw new RunnerError(
        "CIRCLE_API_ERROR",
        `${label} failed: ${sanitizeError(error)}`,
        502,
      );
    }
  }

  // ── Contract Query (read-only) ────────────────────────────────────────

  async queryContract(input: {
    signature: string;
    params: string[];
    contract: string;
    chain: string;
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult> {
    try {
      const client = createPublicClient({
        chain: ARC_TESTNET,
        transport: http(),
      });

      const [funcName] = input.signature.split("(");
      // Build ABI fragment for viem — use type assertion to bypass strict template literal check
      const abi = [`function ${input.signature}`] as readonly string[] as any;

      const result = await client.readContract({
        address: input.contract as `0x${string}`,
        abi,
        functionName: funcName as string,
        args: input.params as readonly unknown[],
      });

      return this.buildResult("contract.query", {
        ok: true,
        outputs: Array.isArray(result) ? result.map(String) : [String(result)],
      });
    } catch (error) {
      throw new RunnerError(
        "CONTRACT_QUERY_ERROR",
        `queryContract failed: ${sanitizeError(error)}`,
        502,
      );
    }
  }

  // ── x402 (not supported via Circle SDK) ──────────────────────────────
  // inspectService and payService are NOT implemented.
  // The Circle Dev Wallet SDK doesn't support x402 payment protocol.

  // ── Gateway (not supported via Circle SDK) ────────────────────────────
  // gatewayBalance and gatewayDeposit are NOT implemented.
  // Circle Gateway operations require Circle CLI.
}
