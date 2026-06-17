import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RunnerError } from "@arclayer/runner-core";
import type { WalletExecutionAdapter, WalletExecuteResult } from "@arclayer/runner-core";

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

export class CircleCliAdapter implements WalletExecutionAdapter {
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

  async walletBalance(address: string, chain: string, signal?: AbortSignal): Promise<CircleCliResult> {
    return this.run(["wallet", "balance", "--address", address, "--chain", chain, "--output", "json"], signal);
  }

  async walletBudget(address: string, signal?: AbortSignal): Promise<CircleCliResult> {
    return this.run(["wallet", "limit", "budget", "--address", address, "--output", "json"], signal);
  }

  async gatewayBalance(address: string, chain: string, signal?: AbortSignal): Promise<CircleCliResult> {
    return this.run(["gateway", "balance", "--address", address, "--chain", chain, "--output", "json"], signal);
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
}
