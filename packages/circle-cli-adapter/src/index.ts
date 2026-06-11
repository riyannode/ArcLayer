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

  private async run(args: string[]): Promise<CircleCliResult> {
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
      timeout: this.timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    });

    const result: CircleCliResult = {
      command: this.bin,
      args,
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
  }): Promise<CircleCliResult> {
    const args = ["services", "inspect", input.url, "--output", "json"];

    if (input.method) args.push("-X", input.method);
    if (input.body !== undefined) args.push("-d", JSON.stringify(input.body));
    for (const header of input.headers ?? []) args.push("-H", header);

    return this.run(args);
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

    return this.run(args);
  }

  // ── Allowlisted Arc Contract Writes ─────────────────────────────────────

  async executeAllowedArcWrite(input: {
    signature: "submit(uint256,bytes32,bytes)" | "register(string)";
    params: string[];
    contract: string;
    address: string;
    chain: string;
    allowRegister?: boolean;
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

    return this.run(args);
  }
}
