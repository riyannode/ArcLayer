/**
 * Circle Developer-Controlled Wallet Adapter.
 * Implements WalletExecutionAdapter using Circle's Dev-Controlled Wallet API/SDK.
 *
 * Security: never logs API key, entity secret, walletId, walletSetId, or bearer tokens.
 */
import { RunnerError } from "@arclayer/runner-core";
import type {
  WalletExecutionAdapter,
  WalletExecuteResult,
} from "@arclayer/runner-core";
import {
  initiateDeveloperControlledWalletsClient,
  type CircleDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";
import { createPublicClient, http, parseAbi, encodeFunctionData } from "viem";
import {
  BatchEvmScheme,
  GATEWAY_DOMAINS,
  CHAIN_CONFIGS,
  type SupportedChainName,
} from "@circle-fin/x402-batching/client";
import type { BatchEvmSigner } from "@circle-fin/x402-batching";
import type { Address, Hex } from "viem";

// ── Types ──────────────────────────────────────────────────────────────

export type CircleDevWalletOptions = {
  apiKey: string;
  entitySecret: string;
  walletId: string;
  walletSetId?: string;
  walletAddress: string;
  chain: string;
  baseUrl?: string;
  accountType?: "EOA" | "SCA";
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
      if (colonIdx >= 0) return match.slice(0, colonIdx + 1) + " [REDACTED]";
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
// ── ERC-8183 ABI for encodeFunctionData ────────────────────────────────
// Circle SDK abiParameters does NOT support bytes/bytes32 types.
// Must pre-encode with viem encodeFunctionData and use callData instead.

const ERC8183_ABI_MAP: Record<string, readonly string[]> = {
  "setBudget(uint256,uint256,bytes)": [
    "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  ],
  "submit(uint256,bytes32,bytes)": [
    "function submit(uint256 jobId, bytes32 deliverableHash, bytes proof)",
  ],
  "fund(uint256,bytes)": [
    "function fund(uint256 jobId, bytes optParams)",
  ],
  "complete(uint256,bytes32,bytes)": [
    "function complete(uint256 jobId, bytes32 reason, bytes proof)",
  ],
  "reject(uint256,bytes32,bytes)": [
    "function reject(uint256 jobId, bytes32 reason, bytes proof)",
  ],
  "createJob(address,address,uint256,string,address)": [
    "function createJob(address provider, address evaluator, uint256 amount, string description, address token)",
  ],
  "claimRefund(uint256)": [
    "function claimRefund(uint256 jobId)",
  ],
  "setProvider(uint256,address)": [
    "function setProvider(uint256 jobId, address provider)",
  ],
};

function encodeErc8183CallData(signature: string, params: unknown[]): Hex {
  const abiStrs = ERC8183_ABI_MAP[signature];
  if (!abiStrs) {
    throw new RunnerError("UNKNOWN_ABI_SIGNATURE", `No ABI for ${signature}`, 500);
  }
  const [funcName] = signature.split("(");
  const abi = parseAbi(abiStrs);
  return encodeFunctionData({
    abi,
    functionName: funcName,
    args: params,
  });
}


// ── Chain Mapping ──────────────────────────────────────────────────────

function mapChain(chain: string): string {
  const normalized = chain.trim().toUpperCase();
  if (normalized === "ARC-TESTNET" || normalized === "ARC" ||
      normalized === "ARCTESTNET" || normalized === "5042002") {
    return "ARC-TESTNET";
  }
  return normalized;
}

/**
 * Map runner chain string → x402-batching SupportedChainName.
 * Returns undefined if the chain is not supported by Gateway.
 */
function toGatewayChainName(chain: string): SupportedChainName | undefined {
  const normalized = chain.trim().toLowerCase().replace(/-/g, "");
  // Direct match
  if (normalized === "arctestnet") return "arcTestnet";
  if (normalized === "basesepolia") return "baseSepolia";
  if (normalized === "basesepolia") return "baseSepolia";
  if (normalized === "arbitrumsepolia") return "arbitrumSepolia";
  if (normalized === "sepolia") return "sepolia";
  // Mainnet
  if (normalized === "base") return "base";
  if (normalized === "arbitrum") return "arbitrum";
  if (normalized === "ethereum") return "ethereum";
  if (normalized === "polygon") return "polygon";
  if (normalized === "avalanche") return "avalanche";
  if (normalized === "optimism") return "optimism";
  return undefined;
}

/**
 * Get the Gateway REST API base URL for the environment.
 */
function gatewayApiUrl(chain: string): string {
  const chainName = toGatewayChainName(chain);
  // Testnet chains use the testnet API
  if (chainName && (chainName.includes("Sepolia") || chainName.includes("Testnet") || chainName === "arcTestnet")) {
    return "https://gateway-api-testnet.circle.com/v1";
  }
  return "https://gateway-api.circle.com/v1";
}

// ── Arc Testnet for viem reads ─────────────────────────────────────────

const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
} as const;

// ── ABI helper for queryContract ───────────────────────────────────────

function queryAbiForSignature(signature: string) {
  switch (signature) {
    case "ownerOf(uint256)":
      return parseAbi(["function ownerOf(uint256) view returns (address)"]);
    case "balanceOf(address)":
      return parseAbi(["function balanceOf(address) view returns (uint256)"]);
    case "allowance(address,address)":
      return parseAbi(["function allowance(address,address) view returns (uint256)"]);
    default:
      throw new RunnerError(
        "CONTRACT_QUERY_SIGNATURE_UNSUPPORTED",
        `circle-dev queryContract does not support signature: ${signature}`,
        400,
      );
  }
}

// ── Adapter ────────────────────────────────────────────────────────────

export class CircleDevWalletAdapter implements WalletExecutionAdapter {
  private readonly apiKey: string;
  private readonly entitySecret: string;
  private readonly walletId: string;
  private readonly walletAddress: string;
  private readonly chain: string;
  private readonly baseUrl?: string;
  private readonly accountType: "EOA" | "SCA";

  private client: CircleDeveloperControlledWalletsClient | null = null;

  constructor(options: CircleDevWalletOptions) {
    if (!options.apiKey) throw new RunnerError("CONFIG_ERROR", "circleApiKey is required", 500);
    if (!options.entitySecret) throw new RunnerError("CONFIG_ERROR", "circleEntitySecret is required", 500);
    if (!options.walletId) throw new RunnerError("CONFIG_ERROR", "circleWalletId is required", 500);
    if (!options.walletAddress) throw new RunnerError("CONFIG_ERROR", "circleWalletAddress is required", 500);

    this.apiKey = options.apiKey;
    this.entitySecret = options.entitySecret;
    this.walletId = options.walletId;
    this.walletAddress = options.walletAddress;
    this.chain = mapChain(options.chain);
    this.baseUrl = options.baseUrl;
    this.accountType = options.accountType ?? "EOA";
  }

  private getClient(): CircleDeveloperControlledWalletsClient {
    if (this.client) return this.client;
    this.client = initiateDeveloperControlledWalletsClient({
      apiKey: this.apiKey,
      entitySecret: this.entitySecret,
    });
    return this.client;
  }

  private buildResult(command: string, json: unknown): WalletExecuteResult {
    return {
      command,
      args: [],
      stdout: JSON.stringify(json ?? {}),
      stderr: "",
      json,
    };
  }

  private async waitForTransaction(
    transactionId: string,
    maxWaitMs = 120_000,
  ): Promise<Record<string, unknown>> {
    const client = this.getClient();
    const deadline = Date.now() + maxWaitMs;
    const TERMINAL = new Set(["COMPLETE", "FAILED", "DENIED", "CANCELLED"]);

    while (Date.now() < deadline) {
      const resp = await client.getTransaction({ id: transactionId });
      const tx = resp.data?.transaction as Record<string, unknown> | undefined;
      if (!tx) break;
      const state = String(tx.state ?? "").toUpperCase();
      if (TERMINAL.has(state)) return tx;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return { id: transactionId, state: "UNKNOWN_TIMEOUT" };
  }

  // ── Version & Status ──────────────────────────────────────────────────

  async version(): Promise<WalletExecuteResult> {
    return this.buildResult("circle-dev-wallet-adapter", {
      version: "0.3.0", adapter: "circle-dev", accountType: this.accountType,
    });
  }

  async walletStatus(): Promise<WalletExecuteResult> {
    try {
      const client = this.getClient();
      const resp = await client.getWallet({ id: this.walletId });
      return this.buildResult("wallet.status", {
        ok: true, walletId: "[REDACTED]",
        state: (resp.data as any)?.wallet?.state, chain: this.chain,
      });
    } catch (error) {
      return this.buildResult("wallet.status", { ok: false, error: sanitizeError(error) });
    }
  }

  // ── Balance ───────────────────────────────────────────────────────────

  async walletBalance(address: string, chain: string, _signal?: AbortSignal): Promise<WalletExecuteResult> {
    try {
      const client = this.getClient();
      const resp = await client.getWalletTokenBalance({ id: this.walletId });
      return this.buildResult("wallet.balance", {
        ok: true, address, chain: mapChain(chain),
        balances: resp.data?.tokenBalances ?? [],
      });
    } catch (error) {
      throw new RunnerError("CIRCLE_API_ERROR", `walletBalance failed: ${sanitizeError(error)}`, 502);
    }
  }

  // ── Gateway Balance (REST API) ────────────────────────────────────────

  async gatewayBalance(address: string, chain: string, signal?: AbortSignal): Promise<WalletExecuteResult> {
    const baseUrl = gatewayApiUrl(chain);
    const chainName = toGatewayChainName(chain);

    if (!chainName) {
      throw new RunnerError(
        "GATEWAY_CHAIN_UNSUPPORTED",
        `Chain "${chain}" is not supported by Circle Gateway`,
        400,
      );
    }

    const domain = GATEWAY_DOMAINS[chainName];
    if (domain === undefined) {
      throw new RunnerError(
        "GATEWAY_DOMAIN_NOT_FOUND",
        `No Gateway domain for chain "${chainName}"`,
        400,
      );
    }

    try {
      const resp = await fetch(`${baseUrl}/balances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: address,
          domains: [domain],
        }),
        signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new RunnerError(
          "GATEWAY_API_ERROR",
          `Gateway balance API failed: ${resp.status} ${redactSecrets(text)}`,
          502,
        );
      }

      const data = await resp.json();
      return this.buildResult("gateway.balance", { ok: true, ...data });
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      throw new RunnerError("GATEWAY_API_ERROR", `gatewayBalance failed: ${sanitizeError(error)}`, 502);
    }
  }

  // ── Gateway Deposit (onchain tx) ──────────────────────────────────────

  async gatewayDeposit(input: {
    amount: string;
    address: string;
    chain: string;
    method?: string;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<WalletExecuteResult> {
    const chainName = toGatewayChainName(input.chain);
    if (!chainName) {
      throw new RunnerError(
        "GATEWAY_CHAIN_UNSUPPORTED",
        `Chain "${input.chain}" is not supported by Circle Gateway deposit`,
        400,
      );
    }

    const config = CHAIN_CONFIGS[chainName];
    if (!config) {
      throw new RunnerError(
        "GATEWAY_CONFIG_NOT_FOUND",
        `No chain config for "${chainName}"`,
        400,
      );
    }

    // Parse amount to atomic units (6 decimals for USDC)
    const parseBalance = (value: string): string => {
      const [whole, decimal = ""] = value.split(".");
      return (whole || "0") + (decimal + "000000").slice(0, 6);
    };

    const amountAtomic = parseBalance(input.amount);
    const gatewayWalletAddress = config.gatewayWallet;
    const usdcAddress = config.usdc;

    try {
      // Step 1: Approve Gateway Wallet to spend USDC
      const approveKey = input.idempotencyKey
        ? `${input.idempotencyKey}:approve`
        : undefined;

      const approveResult = await this.executeContractTransaction(
        usdcAddress,
        "approve(address,uint256)",
        [gatewayWalletAddress, amountAtomic],
        "gateway.approve",
        approveKey,
      );

      const approveData = approveResult.json as Record<string, unknown> | undefined;
      const approveState = String((approveData as any)?.data?.state ?? "").toUpperCase();
      if (approveState !== "COMPLETE" && approveState !== "CONFIRMED") {
        return this.buildResult("gateway.deposit", {
          ok: false,
          error: `Approval did not complete (state=${approveState})`,
          approveResult,
        });
      }

      // Step 2: Deposit USDC into Gateway Wallet
      const depositKey = input.idempotencyKey
        ? `${input.idempotencyKey}:deposit`
        : undefined;

      const depositResult = await this.executeContractTransaction(
        gatewayWalletAddress,
        "deposit(address,uint256)",
        [usdcAddress, amountAtomic],
        "gateway.deposit",
        depositKey,
      );

      const depositData = depositResult.json as Record<string, unknown> | undefined;
      const depositState = String((depositData as any)?.data?.state ?? "").toUpperCase();

      return this.buildResult("gateway.deposit", {
        ok: depositState === "COMPLETE" || depositState === "CONFIRMED",
        amount: input.amount,
        amountAtomic,
        approveResult: approveResult.json,
        depositResult: depositResult.json,
      });
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      throw new RunnerError("GATEWAY_DEPOSIT_ERROR", `gatewayDeposit failed: ${sanitizeError(error)}`, 502);
    }
  }

  // ── Contract Execution ────────────────────────────────────────────────

  async executeErc8183Write(input: {
    signature: string; params: string[]; contract: string;
    address: string; chain: string; idempotencyKey?: string; signal?: AbortSignal;
  }): Promise<WalletExecuteResult> {
    if (!ERC8183_SIGNATURES.has(input.signature)) {
      throw new RunnerError("ERC8183_SIGNATURE_BLOCKED",
        `Signature "${input.signature}" is not in the ERC-8183 lifecycle allowlist`, 403);
    }
    // Pre-encode calldata — Circle SDK abiParameters does NOT support bytes/bytes32
    const callData = encodeErc8183CallData(input.signature, input.params);
    return this.executeContractTransaction(
      input.contract, input.signature, input.params,
      `erc8183.${input.signature.split("(")[0]}`, input.idempotencyKey, callData,
    );
  }

  async approveUsdc(input: {
    amount: string; usdcAddress: string; spenderAddress: string;
    walletAddress: string; chain: string; idempotencyKey?: string; signal?: AbortSignal;
  }): Promise<WalletExecuteResult> {
    return this.executeContractTransaction(
      input.usdcAddress, "approve(address,uint256)",
      [input.spenderAddress, input.amount], "erc20.approve", input.idempotencyKey,
    );
  }

  async executeAllowedArcWrite(input: {
    signature: "submit(uint256,bytes32,bytes)" | "register(string)";
    params: string[]; contract: string; address: string; chain: string;
    allowRegister?: boolean; idempotencyKey?: string; signal?: AbortSignal;
  }): Promise<WalletExecuteResult> {
    if (input.signature === "register(string)" && !input.allowRegister) {
      throw new RunnerError("ERC8004_REGISTER_BLOCKED",
        "ERC-8004 register execution is blocked by default", 403);
    }
    if (input.signature !== "submit(uint256,bytes32,bytes)" && input.signature !== "register(string)") {
      throw new RunnerError("ARC_CONTRACT_METHOD_BLOCKED",
        "Only allowlisted ArcLayer contract methods are allowed", 403);
    }
    // submit(uint256,bytes32,bytes) has bytes params — must use pre-encoded callData.
    // register(string) has no bytes params — safe to use abiFunctionSignature path.
    const label = `arc.${input.signature.split("(")[0]}`;
    if (input.signature === "submit(uint256,bytes32,bytes)") {
      const callData = encodeErc8183CallData(input.signature, input.params);
      return this.executeContractTransaction(
        input.contract, input.signature, input.params, label, input.idempotencyKey, callData,
      );
    }
    return this.executeContractTransaction(
      input.contract, input.signature, input.params, label, input.idempotencyKey,
    );
  }

  private async executeContractTransaction(
    contractAddress: string, abiFunctionSignature: string,
    abiParameters: string[], label: string, idempotencyKey?: string, callData?: Hex,
  ): Promise<WalletExecuteResult> {
    try {
      const client = this.getClient();

      if (!idempotencyKey) {
        throw new RunnerError("MISSING_IDEMPOTENCY_KEY",
          `${label} requires gateway idempotencyKey`, 500);
      }

      // Circle SDK callData is mutually exclusive with abiFunctionSignature + abiParameters.
      // For ERC-8183 methods with bytes/bytes32 params, caller pre-encodes callData via viem.
      // Narrow cast: Circle SDK v10.6.0 types expose callData as a union branch.
      const txRequest = callData
        ? { walletId: this.walletId, contractAddress, callData, fee: { type: "level" as const, config: { feeLevel: "MEDIUM" as const } }, idempotencyKey }
        : { walletId: this.walletId, contractAddress, abiFunctionSignature, abiParameters, fee: { type: "level" as const, config: { feeLevel: "MEDIUM" as const } }, idempotencyKey };

      // Diagnostic: log call metadata (no secrets)
      const diagParts = [`label=${label}`, `contract=${contractAddress.slice(0, 10)}...`, `params=${abiParameters.length}`];
      if (callData) diagParts.push(`callData=${callData.length}chars`);
      else diagParts.push(`sig=${abiFunctionSignature}`);
      process.stdout.write(`[circle-adapter] ${diagParts.join(" | ")}\n`);

      const resp = await client.createContractExecutionTransaction(
        txRequest as Parameters<typeof client.createContractExecutionTransaction>[0],
      );

      const transactionId = resp.data?.id as string | undefined;
      if (!transactionId) {
        return this.buildResult(label, {
          ok: false, error: "No transaction ID returned from Circle API", raw: resp.data,
        });
      }

      const tx = await this.waitForTransaction(transactionId);
      const state = String(tx.state ?? "").toUpperCase();
      const txHash = tx.txHash as string | undefined;

      return this.buildResult(label, {
        ok: state === "COMPLETE",
        data: { id: transactionId, state, txHash },
      });
    } catch (error) {
      throw new RunnerError("CIRCLE_API_ERROR", `${label} failed: ${sanitizeError(error)}`, 502);
    }
  }

  // ── Contract Query (read-only) ────────────────────────────────────────

  async queryContract(input: {
    signature: string; params: string[]; contract: string; chain: string; signal?: AbortSignal;
  }): Promise<WalletExecuteResult> {
    try {
      const client = createPublicClient({ chain: ARC_TESTNET, transport: http() });
      const [funcName] = input.signature.split("(");
      const abi = queryAbiForSignature(input.signature);

      const result = await client.readContract({
        address: input.contract as `0x${string}`,
        abi,
        functionName: funcName as never,
        args: input.params as readonly unknown[],
      });

      return this.buildResult("contract.query", {
        ok: true,
        outputs: Array.isArray(result) ? (result as unknown[]).map(String) : [String(result)],
      });
    } catch (error) {
      throw new RunnerError("CONTRACT_QUERY_ERROR", `queryContract failed: ${sanitizeError(error)}`, 502);
    }
  }

  // ── x402 Inspect Service ──────────────────────────────────────────────

  async inspectService(input: {
    url: string; method?: string; body?: unknown; headers?: string[]; signal?: AbortSignal;
  }): Promise<WalletExecuteResult> {
    try {
      const method = input.method ?? "GET";
      const fetchHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      for (const h of input.headers ?? []) {
        const idx = h.indexOf(":");
        if (idx > 0) fetchHeaders[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
      }

      const resp = await fetch(input.url, {
        method,
        headers: fetchHeaders,
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        signal: input.signal,
      });

      const status = resp.status;
      const responseHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => { responseHeaders[k] = v; });

      let body: unknown;
      try {
        body = await resp.json();
      } catch {
        body = await resp.text().catch(() => "");
      }

      // Parse PAYMENT-REQUIRED header if present (402 response)
      const paymentRequired = responseHeaders["payment-required"]
        ?? responseHeaders["PAYMENT-REQUIRED"];

      return this.buildResult("x402.inspect", {
        ok: true,
        status,
        paymentRequired: status === 402,
        requirements: paymentRequired ? JSON.parse(paymentRequired) : undefined,
        headers: responseHeaders,
        body,
      });
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      throw new RunnerError("X402_INSPECT_ERROR", `inspectService failed: ${sanitizeError(error)}`, 502);
    }
  }

  // ── x402 Pay Service ─────────────────────────────────────────────────

  async payService(input: {
    url: string; address: string; chain: string; maxAmountUsdc: string;
    method?: string; body?: unknown; headers?: string[];
    timeoutSeconds?: number; idempotencyKey?: string; signal?: AbortSignal;
  }): Promise<WalletExecuteResult> {
    const chainName = toGatewayChainName(input.chain);
    if (!chainName) {
      throw new RunnerError(
        "X402_CHAIN_UNSUPPORTED",
        `Chain "${input.chain}" is not supported for x402 payments`,
        400,
      );
    }

    const domain = GATEWAY_DOMAINS[chainName];
    if (domain === undefined) {
      throw new RunnerError("X402_DOMAIN_NOT_FOUND", `No Gateway domain for "${chainName}"`, 400);
    }

    try {
      // Step 1: Make initial request to get 402 + payment requirements
      const method = input.method ?? "GET";
      const fetchHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      for (const h of input.headers ?? []) {
        const idx = h.indexOf(":");
        if (idx > 0) fetchHeaders[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
      }

      const initialResp = await fetch(input.url, {
        method,
        headers: fetchHeaders,
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        signal: input.signal,
      });

      if (initialResp.status !== 402) {
        // Not a 402 — resource may be free or already paid
        let body: unknown;
        try { body = await initialResp.json(); } catch { body = await initialResp.text(); }
        return this.buildResult("x402.pay", {
          ok: true,
          status: initialResp.status,
          alreadyAccessible: true,
          body,
        });
      }

      // Step 2: Parse payment requirements from PAYMENT-REQUIRED header
      const paymentRequiredHeader =
        initialResp.headers.get("payment-required") ??
        initialResp.headers.get("PAYMENT-REQUIRED");

      if (!paymentRequiredHeader) {
        throw new RunnerError("X402_NO_REQUIREMENTS", "402 response missing PAYMENT-REQUIRED header", 502);
      }

      const requirements = JSON.parse(paymentRequiredHeader);
      // requirements may be an array or single object
      const reqArray = Array.isArray(requirements) ? requirements : [requirements];

      // Find the Circle Gateway batching option
      const gatewayReq = reqArray.find((r: any) =>
        r?.extra?.name === "GatewayWalletBatched" ||
        (r?.scheme === "exact" && r?.extra?.verifyingContract)
      );

      if (!gatewayReq) {
        throw new RunnerError(
          "X402_NO_GATEWAY_OPTION",
          "No Circle Gateway batching payment option found in requirements",
          400,
        );
      }

      // Validate maxAmountUsdc
      const reqAmount = BigInt(gatewayReq.amount ?? "0");
      const maxAmount = BigInt(Math.floor(parseFloat(input.maxAmountUsdc) * 1_000_000));
      if (reqAmount > maxAmount) {
        throw new RunnerError(
          "X402_AMOUNT_EXCEEDED",
          `Required amount (${gatewayReq.amount}) exceeds max (${input.maxAmountUsdc} USDC)`,
          400,
        );
      }

      // Step 3: Create BatchEvmSigner using Circle Dev Wallet's signTypedData
      const client = this.getClient();
      const signer: BatchEvmSigner = {
        address: input.address as Address,
        signTypedData: async (params: {
          domain: { name: string; version: string; chainId: number; verifyingContract: Address };
          types: Record<string, Array<{ name: string; type: string }>>;
          primaryType: string;
          message: Record<string, unknown>;
        }) => {
          const resp = await client.signTypedData({
            walletAddress: input.address,
            blockchain: mapChain(input.chain),
            data: JSON.stringify(params, (_key, value) =>
              typeof value === "bigint" ? value.toString() : value
            ),
          });
          const sig = resp.data?.signature;
          if (!sig) {
            throw new RunnerError("X402_SIGN_FAILED", "Circle Dev Wallet signTypedData returned no signature", 502);
          }
          return sig as Hex;
        },
      };

      // Step 4: Create payment payload using BatchEvmScheme
      const scheme = new BatchEvmScheme(signer);
      const paymentPayload = await scheme.createPaymentPayload(
        1, // x402Version
        {
          scheme: gatewayReq.scheme,
          network: gatewayReq.network,
          asset: gatewayReq.asset,
          amount: gatewayReq.amount,
          payTo: gatewayReq.payTo,
          maxTimeoutSeconds: gatewayReq.maxTimeoutSeconds ?? 60,
          extra: gatewayReq.extra,
        },
      );

      // Step 5: Retry request with PAYMENT-SIGNATURE header
      const paymentSignatureValue = btoa(JSON.stringify({
        x402Version: paymentPayload.x402Version,
        payload: paymentPayload.payload,
      }));

      const retryResp = await fetch(input.url, {
        method,
        headers: {
          ...fetchHeaders,
          "PAYMENT-SIGNATURE": paymentSignatureValue,
        },
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        signal: input.signal,
      });

      let responseBody: unknown;
      try { responseBody = await retryResp.json(); } catch { responseBody = await retryResp.text(); }

      const responseHeaders: Record<string, string> = {};
      retryResp.headers.forEach((v, k) => { responseHeaders[k] = v; });

      // Parse PAYMENT-RESPONSE header
      const paymentResponseHeader =
        retryResp.headers.get("payment-response") ??
        retryResp.headers.get("PAYMENT-RESPONSE");

      return this.buildResult("x402.pay", {
        ok: retryResp.ok,
        status: retryResp.status,
        amount: gatewayReq.amount,
        paymentResponse: paymentResponseHeader ? JSON.parse(paymentResponseHeader) : undefined,
        headers: responseHeaders,
        body: responseBody,
      });
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      throw new RunnerError("X402_PAY_ERROR", `payService failed: ${sanitizeError(error)}`, 502);
    }
  }
}
