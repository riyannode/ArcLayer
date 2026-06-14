import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RunnerError } from "@arclayer/runner-core";

const execFileAsync = promisify(execFile);

export type CircleCliOptions = {
  bin: string;
  timeoutMs?: number;
};

export type CircleCliResult = {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  json?: unknown;
};

function redact(value: string): string {
  return value
    .replace(/--otp\s+\S+/g, "--otp [REDACTED]")
    .replace(/--private-key\s+\S+/g, "--private-key [REDACTED]")
    .replace(/--mnemonic\s+.+/g, "--mnemonic [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
}

/**
 * Redact -d (body) arguments from CLI args array.
 * Prevents sensitive payment bodies from being persisted in receipts.
 */
function redactArgs(args: string[]): string[] {
  const result: string[] = [];
  let skipNext = false;
  for (const arg of args) {
    if (skipNext) {
      result.push("[REDACTED_BODY]");
      skipNext = false;
      continue;
    }
    if (arg === "-d" || arg === "--data") {
      result.push(arg);
      skipNext = true;
      continue;
    }
    result.push(arg);
  }
  return result;
}

function tryParseJson(stdout: string): unknown | undefined {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

export class CircleCliAdapter {
  private readonly bin: string;
  private readonly timeoutMs: number;

  constructor(options: CircleCliOptions) {
    this.bin = options.bin;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private async run(args: string[], signal?: AbortSignal): Promise<CircleCliResult> {
    const joined = args.join(" ");

    // ── Blocked commands ──────────────────────────────────────────────────
    if (args.includes("import")) {
      throw new RunnerError("CIRCLE_COMMAND_BLOCKED", "circle wallet import is blocked", 403);
    }

    if (args[0] === "gateway" && args[1] === "withdraw") {
      throw new RunnerError("CIRCLE_COMMAND_BLOCKED", "circle gateway withdraw is blocked", 403);
    }

    if (args[0] === "transaction" && ["cancel", "accelerate"].includes(args[1] ?? "")) {
      throw new RunnerError("CIRCLE_COMMAND_BLOCKED", `circle ${joined} is blocked`, 403);
    }

    if (args[0] === "wallet" && args[1] === "sign") {
      throw new RunnerError("CIRCLE_COMMAND_BLOCKED", "wallet signing is blocked for LLM runtime", 403);
    }

    // Block unrestricted execute (only allowlisted signatures via executeAllowedArcWrite)
    if (args[0] === "wallet" && args[1] === "execute" && !args.includes("--contract")) {
      throw new RunnerError(
        "CIRCLE_COMMAND_BLOCKED",
        "unrestricted circle wallet execute is blocked",
        403
      );
    }

    const { stdout, stderr } = await execFileAsync(this.bin, args, {
      // When a signal is provided (broker timeout), don't set execFile timeout.
      // The broker's AbortSignal handles cancellation at the correct deadline.
      // Without signal, use the adapter's default timeout as a safety net.
      ...(signal ? {} : { timeout: this.timeoutMs }),
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, CIRCLE_ACCEPT_TERMS: "1" },
      signal,
    });

    const result: CircleCliResult = {
      command: this.bin,
      args: redactArgs(args),
      stdout: redact(stdout),
      stderr: redact(stderr),
      json: tryParseJson(stdout)
    };

    return result;
  }

  // ── Version & Status ────────────────────────────────────────────────────

  async version(): Promise<CircleCliResult> {
    return this.run(["--version"]);
  }

  async walletStatus(): Promise<CircleCliResult> {
    return this.run(["wallet", "status", "--type", "agent", "--output", "json"]);
  }

  // ── Balance & Budget ────────────────────────────────────────────────────

  async walletBalance(address: string, chain: string): Promise<CircleCliResult> {
    return this.run(["wallet", "balance", "--address", address, "--chain", chain, "--output", "json"]);
  }

  async walletBudget(address: string): Promise<CircleCliResult> {
    return this.run(["wallet", "limit", "budget", "--address", address, "--output", "json"]);
  }

  async gatewayBalance(address: string, chain: string): Promise<CircleCliResult> {
    return this.run(["gateway", "balance", "--address", address, "--chain", chain, "--output", "json"]);
  }

  // ── x402 Services ──────────────────────────────────────────────────────

  async inspectService(input: {
    url: string;
    method?: string;
    body?: unknown;
    headers?: string[];
    /** AbortSignal for cancellation (e.g. broker timeout). */
    signal?: AbortSignal;
  }): Promise<CircleCliResult> {
    const args = ["services", "inspect", input.url, "--output", "json"];

    if (input.method) args.push("-X", input.method);
    if (input.body !== undefined) args.push("-d", JSON.stringify(input.body));
    for (const header of input.headers ?? []) args.push("-H", header);

    return this.run(args, input.signal);
  }

  async payService(input: {
    url: string;
    address: string;
    chain: string;
    maxAmountUsdc: string;
    method?: string;
    body?: unknown;
    headers?: string[];
    timeoutSeconds?: number;
    /** AbortSignal for cancellation (e.g. broker timeout). */
    signal?: AbortSignal;
  }): Promise<CircleCliResult> {
    const args = [
      "services",
      "pay",
      input.url,
      "--address",
      input.address,
      "--chain",
      input.chain,
      "--max-amount",
      input.maxAmountUsdc,
      "--output",
      "json"
    ];

    if (input.method) args.push("-X", input.method);
    if (input.body !== undefined) args.push("-d", JSON.stringify(input.body));
    for (const header of input.headers ?? []) args.push("-H", header);
    if (input.timeoutSeconds) args.push("--timeout", String(input.timeoutSeconds));

    return this.run(args, input.signal);
  }

  // ── Allowlisted Arc Contract Writes ─────────────────────────────────────

  /**
   * ERC-8183 lifecycle allowlist.
   * Each signature maps to a specific AgenticCommerce contract method.
   * No open-ended execute — only these exact signatures are accepted.
   */
  static readonly ERC8183_SIGNATURES = new Set([
    "submit(uint256,bytes32,bytes)",
    "createJob(address,address,uint256,string,address)",
    "setBudget(uint256,uint256,bytes)",
    "fund(uint256,bytes)",
    "complete(uint256,bytes32,bytes)",
    "reject(uint256,bytes32,bytes)",
    "claimRefund(uint256)",
    "setProvider(uint256,address)",
  ]);

  /**
   * Execute an allowlisted ERC-8183 lifecycle write on the AgenticCommerce contract.
   * Only signatures in ERC8183_SIGNATURES are accepted.
   */
  async executeErc8183Write(input: {
    signature: string;
    params: string[];
    contract: string;
    address: string;
    chain: string;
    /** AbortSignal for cancellation (e.g. broker timeout). */
    signal?: AbortSignal;
  }): Promise<CircleCliResult> {
    if (!CircleCliAdapter.ERC8183_SIGNATURES.has(input.signature)) {
      throw new RunnerError(
        "ERC8183_SIGNATURE_BLOCKED",
        `Signature "${input.signature}" is not in the ERC-8183 lifecycle allowlist`,
        403
      );
    }

    const args = [
      "wallet",
      "execute",
      input.signature,
      ...input.params,
      "--contract",
      input.contract,
      "--address",
      input.address,
      "--chain",
      input.chain,
      "--output",
      "json"
    ];

    return this.run(args, input.signal);
  }

  /**
   * Execute USDC approve for ERC-8183 contract.
   * Approves AgenticCommerce to spend USDC.
   */
  async approveUsdc(input: {
    amount: string;
    usdcAddress: string;
    spenderAddress: string;
    walletAddress: string;
    chain: string;
    /** AbortSignal for cancellation (e.g. broker timeout). */
    signal?: AbortSignal;
  }): Promise<CircleCliResult> {
    const args = [
      "wallet",
      "execute",
      "approve(address,uint256)",
      input.spenderAddress,
      input.amount,
      "--contract",
      input.usdcAddress,
      "--address",
      input.walletAddress,
      "--chain",
      input.chain,
      "--output",
      "json"
    ];

    return this.run(args, input.signal);
  }

  /**
   * Deposit USDC into Circle Gateway for nanopayments.
   * Gated behind explicit allowGatewayDeposit flag.
   */
  async gatewayDeposit(input: {
    amount: string;
    address: string;
    chain: string;
    method?: string;
    /** AbortSignal for cancellation (e.g. broker timeout). */
    signal?: AbortSignal;
  }): Promise<CircleCliResult> {
    // Default method: direct for ARC-TESTNET, eco only for BASE/BASE-SEPOLIA
    let method = input.method;
    if (!method) {
      method = input.chain.toUpperCase().includes("ARC") ? "direct" : "direct";
    }

    // Reject eco on ARC-TESTNET — eco only supports BASE/BASE-SEPOLIA
    if (method === "eco" && input.chain.toUpperCase().includes("ARC")) {
      throw new RunnerError(
        "GATEWAY_DEPOSIT_METHOD_INVALID",
        "Gateway deposit method 'eco' is not supported on ARC-TESTNET. Use 'direct' instead.",
        400
      );
    }

    const args = [
      "gateway",
      "deposit",
      "--amount",
      input.amount,
      "--address",
      input.address,
      "--chain",
      input.chain,
      "--method",
      method,
      "--output",
      "json"
    ];

    return this.run(args, input.signal);
  }

  /**
   * Legacy method: execute an allowlisted Arc write.
   * Kept for backward compatibility with existing submit flow.
   */
  async executeAllowedArcWrite(input: {
    signature: "submit(uint256,bytes32,bytes)" | "register(string)";
    params: string[];
    contract: string;
    address: string;
    chain: string;
    allowRegister?: boolean;
    /** AbortSignal for cancellation (e.g. broker timeout). */
    signal?: AbortSignal;
  }): Promise<CircleCliResult> {
    if (input.signature === "register(string)" && !input.allowRegister) {
      throw new RunnerError(
        "ERC8004_REGISTER_BLOCKED",
        "ERC-8004 register execution is blocked by default; use prepare-register unless explicitly allowed",
        403
      );
    }

    if (input.signature !== "submit(uint256,bytes32,bytes)" && input.signature !== "register(string)") {
      throw new RunnerError("ARC_CONTRACT_METHOD_BLOCKED", "Only allowlisted ArcLayer contract methods are allowed", 403);
    }

    const args = [
      "wallet",
      "execute",
      input.signature,
      ...input.params,
      "--contract",
      input.contract,
      "--address",
      input.address,
      "--chain",
      input.chain,
      "--output",
      "json"
    ];

    return this.run(args, input.signal);
  }

  /**
   * Query a smart contract (read-only).
   * Used for ownerOf, getJob, balanceOf, etc.
   */
  async queryContract(input: {
    signature: string;
    params: string[];
    contract: string;
    chain: string;
    /** AbortSignal for cancellation. */
    signal?: AbortSignal;
  }): Promise<CircleCliResult> {
    const args = [
      "contract",
      "query",
      input.signature,
      ...input.params,
      "--contract",
      input.contract,
      "--chain",
      input.chain,
      "--output",
      "json"
    ];

    return this.run(args, input.signal);
  }

  // ── Transaction History (for reconciliation) ───────────────────────────

  /**
   * List Circle CLI transactions for a wallet address.
   * Used by the transaction reconciler to match Circle tx IDs to onchain receipts.
   */
  async transactionList(input: {
    address: string;
    chain: string;
    operation?: "transfer" | "execute";
    state?: Exclude<CircleTransactionState, "unknown">;
    limit?: number;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<CircleCliResult> {
    const args = [
      "transaction", "list",
      "--address", input.address,
      "--chain", input.chain,
      "--output", "json",
    ];
    if (input.operation) args.push("--operation", input.operation);
    if (input.state) args.push("--state", input.state);
    if (input.limit) args.push("--limit", String(input.limit));
    if (input.cursor) args.push("--cursor", input.cursor);
    return this.run(args, input.signal);
  }
}

// ── Transaction Normalization (for reconciliation) ─────────────────────

/**
 * Circle CLI terminal states.
 * Maps to onchain reconciliation outcomes.
 */
export type CircleTransactionState =
  | "initiated"
  | "queued"
  | "sent"
  | "confirmed"
  | "complete"
  | "failed"
  | "cancelled"
  | "denied"
  | "cleared"
  | "stuck"
  | "unknown";

/**
 * Normalized Circle transaction from CLI output.
 * Tolerant of varying response envelopes.
 */
export type NormalizedCircleTransaction = {
  id?: string;
  txHash?: string;
  state: CircleTransactionState;
  operation?: string;
  contractAddress?: string;
  abiFunctionSignature?: string;
  createdAt?: string;
  raw: unknown;
};

/**
 * Normalize a raw Circle CLI transaction object into a consistent shape.
 * Circle CLI output may have fields at different nesting levels.
 */
export function normalizeCircleTransaction(raw: unknown): NormalizedCircleTransaction {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const data = (obj.data ?? obj) as Record<string, unknown>;

  const id = (obj.id ?? data.id ?? data.transactionId ?? undefined) as string | undefined;
  const txHash = (obj.txHash ?? data.txHash ?? data.hash ?? data.transactionHash ?? undefined) as string | undefined;
  const stateRaw = (obj.state ?? data.state ?? obj.status ?? data.status ?? "unknown") as string;
  const operation = (obj.operation ?? data.operation ?? undefined) as string | undefined;
  const contractAddress = (obj.contractAddress ?? data.contractAddress ?? undefined) as string | undefined;
  const abiFunctionSignature = (obj.abiFunctionSignature ?? data.abiFunctionSignature ?? undefined) as string | undefined;
  const createdAt = (obj.createdAt ?? data.createdAt ?? obj.created_at ?? data.created_at ?? undefined) as string | undefined;

  return {
    id: id ? String(id) : undefined,
    txHash: txHash ? String(txHash) : undefined,
    state: normalizeCircleState(stateRaw),
    operation: operation ? String(operation) : undefined,
    contractAddress: contractAddress ? String(contractAddress) : undefined,
    abiFunctionSignature: abiFunctionSignature ? String(abiFunctionSignature) : undefined,
    createdAt: createdAt ? String(createdAt) : undefined,
    raw,
  };
}

/**
 * Extract all transactions from a CircleCliResult, handling multiple response envelopes:
 * - array directly
 * - { data: [...] }
 * - { transactions: [...] }
 * - { data: { transactions: [...] } }
 */
export function extractCircleTransactions(result: CircleCliResult): NormalizedCircleTransaction[] {
  const json = result.json;
  if (!json) return [];

  let rawList: unknown[] = [];
  if (Array.isArray(json)) {
    rawList = json;
  } else if (typeof json === "object" && json !== null) {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      rawList = obj.data;
    } else if (Array.isArray(obj.transactions)) {
      rawList = obj.transactions;
    } else if (obj.data && typeof obj.data === "object" && Array.isArray((obj.data as Record<string, unknown>).transactions)) {
      rawList = (obj.data as Record<string, unknown>).transactions as unknown[];
    }
  }

  return rawList.map(normalizeCircleTransaction);
}

/**
 * Extract Circle transaction ID from a CircleCliResult (single tx response).
 */
export function extractCircleTransactionId(result: CircleCliResult): string | undefined {
  const json = result.json;
  if (!json || typeof json !== "object") return undefined;
  const obj = json as Record<string, unknown>;
  const data = (obj.data ?? obj) as Record<string, unknown>;
  const id = data.id ?? data.transactionId ?? obj.id ?? obj.transactionId;
  return id ? String(id) : undefined;
}

/**
 * Extract txHash from a CircleCliResult (single tx response).
 */
export function extractCircleTxHash(result: CircleCliResult): string | undefined {
  const json = result.json;
  if (!json || typeof json !== "object") return undefined;
  const obj = json as Record<string, unknown>;
  const data = (obj.data ?? obj) as Record<string, unknown>;
  const hash = data.txHash ?? data.hash ?? data.transactionHash ?? obj.txHash ?? obj.hash;
  return hash ? String(hash) : undefined;
}

/**
 * Extract normalized state from a CircleCliResult (single tx response).
 */
export function extractCircleState(result: CircleCliResult): CircleTransactionState {
  const json = result.json;
  if (!json || typeof json !== "object") return "unknown";
  const obj = json as Record<string, unknown>;
  const data = (obj.data ?? obj) as Record<string, unknown>;
  const stateRaw = String(data.state ?? obj.state ?? data.status ?? obj.status ?? "unknown");
  return normalizeCircleState(stateRaw);
}

/**
 * Map raw Circle CLI state strings to canonical CircleTransactionState.
 */
function normalizeCircleState(raw: string): CircleTransactionState {
  const lower = raw.toLowerCase();
  const map: Record<string, CircleTransactionState> = {
    initiated: "initiated",
    queued: "queued",
    sent: "sent",
    confirmed: "confirmed",
    complete: "complete",
    failed: "failed",
    cancelled: "cancelled",
    denied: "denied",
    cleared: "cleared",
    stuck: "stuck",
  };
  return map[lower] ?? "unknown";
}
