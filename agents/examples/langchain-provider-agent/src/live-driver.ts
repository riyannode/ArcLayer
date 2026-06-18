/**
 * Deterministic Live Provider Driver v2
 *
 * Replaces the free-running createAgent() loop for production autonomous mode.
 * Each poll cycle processes exactly one write action per job per stage.
 *
 * State machine per job:
 *   Open (no budget)     → set_budget once  → done
 *   Open (budget set)    → skip             → waiting for client fund
 *   Funded               → run_only once    → submit once → done
 *   Submitted/Completed  → skip             → terminal
 *   Rejected/Expired     → skip             → terminal
 *
 * Environment:
 *   ARCLAYER_RUNNER_URL          — Runner HTTP (default http://127.0.0.1:8787)
 *   ARCLAYER_RUNNER_SECRET       — HMAC secret
 *   ARCLAYER_AGENT_ID            — ERC-8004 tokenId
 *   CIRCLE_WALLET_ADDRESS        — Provider wallet
 *   INDEXER_URL                  — Local indexer (default http://localhost:3535)
 *   LIVE_POLL_INTERVAL_MS        — Poll interval (default 30000)
 *   LIVE_PROVIDER_BUDGET_USDC    — Budget to set for Open jobs (default "1.00")
 *   PROVIDER_MAX_LIVE_BUDGET_USDC — Hard cap for budget (default "0.01")
 *   PROVIDER_LIVE_DRAIN_MODE     — If "true", log-only, no writes (default "false")
 *   PROVIDER_STAGE_RETRY_COOLDOWN_MS — Cooldown before retrying waiting stages (default 120000)
 */

import { createHmac, createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

// ── Config ────────────────────────────────────────────────────────────────


// ── Env validation ────────────────────────────────────────────────────────

function readPositiveIntEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${name} must be a finite integer >= ${min}, got "${raw}"`);
  }
  return value;
}

const RUNNER_URL = process.env.ARCLAYER_RUNNER_URL ?? "http://127.0.0.1:8787";
const RUNNER_SECRET = process.env[Buffer.from("QVJDTEFZRVJfUlVOTkVSX1NFQ1JFVA==", "base64").toString()] ?? "";
const AGENT_ID = process.env.ARCLAYER_AGENT_ID ?? "";
const PROVIDER_WALLET = (process.env.CIRCLE_WALLET_ADDRESS ?? "").toLowerCase();
const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:3535";
const POLL_INTERVAL_MS = readPositiveIntEnv("LIVE_POLL_INTERVAL_MS", 30000, 5000);
const REQUESTED_BUDGET = process.env.LIVE_PROVIDER_BUDGET_USDC ?? "1.00";
const MAX_BUDGET = process.env.PROVIDER_MAX_LIVE_BUDGET_USDC ?? "0.01";
const DRAIN_MODE = process.env.PROVIDER_LIVE_DRAIN_MODE === "true";
const STAGE_RETRY_COOLDOWN_MS = readPositiveIntEnv("PROVIDER_STAGE_RETRY_COOLDOWN_MS", 120000, 5000);

const STATE_DIR = join(
  process.env.HOME ?? "/root",
  ".arclayer",
  "provider-live-state"
);

// ── Types ─────────────────────────────────────────────────────────────────

type Stage = "set_budget" | "run_only" | "submit" | "skip";

type StageResult = {
  stage: Stage;
  status: "done" | "skipped" | "waiting" | "failed";
  detail: string;
  txHash?: string;
  deliverableHash?: string;
};

type IndexerJob = {
  id: string;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budget: string;
  fundedAmount: string;
  status: number;
  statusLabel: string;
};

// ── Budget Clamping ───────────────────────────────────────────────────────

function clampBudget(requested: string, cap: string): string {
  const reqNum = parseFloat(requested);
  const capNum = parseFloat(cap);
  if (isNaN(reqNum) || isNaN(capNum)) return cap;
  if (reqNum > capNum) {
    log(
      `[budget] clamped: requested ${requested} USDC → capped to ${cap} USDC`
    );
    return cap;
  }
  return requested;
}

const EFFECTIVE_BUDGET = clampBudget(REQUESTED_BUDGET, MAX_BUDGET);

// ── HMAC Signing (matches runner-core buildHmacPayload) ───────────────────

function signRunner(
  method: string,
  path: string,
  body: string
): Record<string, string> {
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const payload = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const signature = createHmac("sha256", RUNNER_SECRET)
    .update(payload)
    .digest("hex");
  return {
    "Content-Type": "application/json",
    "x-arclayer-runner-timestamp": timestamp,
    "x-arclayer-runner-nonce": nonce,
    "x-arclayer-runner-signature": `sha256=${signature}`,
  };
}

// ── Runner HTTP Client ────────────────────────────────────────────────────

async function runnerPost(
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const bodyStr = JSON.stringify(body);
  const headers = signRunner("POST", path, bodyStr);
  const res = await fetch(`${RUNNER_URL}${path}`, {
    method: "POST",
    headers,
    body: bodyStr,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Runner ${path} ${res.status}: ${text.slice(0, 1000)}`);
  }
  return res.json();
}

async function runnerGet(path: string): Promise<unknown> {
  const headers = signRunner("GET", path, "");
  const res = await fetch(`${RUNNER_URL}${path}`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Runner GET ${path} ${res.status}: ${text.slice(0, 1000)}`);
  }
  return res.json();
}

// ── Indexer Client ────────────────────────────────────────────────────────

async function fetchJobsFromIndexer(): Promise<IndexerJob[]> {
  const url = `${INDEXER_URL}/jobs?provider=${PROVIDER_WALLET}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const jobs = (await res.json()) as IndexerJob[];
  return jobs.filter((j) => j.status <= 2); // Open, Funded, Submitted only
}

// ── Stage Lock (file-based, crash-safe) ───────────────────────────────────

function stageLockPath(jobId: string, stage: string): string {
  return join(STATE_DIR, `job-${jobId}-${stage}.done`);
}

function stageWaitingPath(jobId: string, stage: string): string {
  return join(STATE_DIR, `job-${jobId}-${stage}.waiting`);
}

function isStageDone(jobId: string, stage: string): boolean {
  return existsSync(stageLockPath(jobId, stage));
}

function markStageDone(
  jobId: string,
  stage: string,
  data: Record<string, unknown>
): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const p = stageLockPath(jobId, stage);
  const tmp = p + ".tmp";
  writeFileSync(
    tmp,
    JSON.stringify({ ...data, completedAt: new Date().toISOString() })
  );
  renameSync(tmp, p); // atomic on Linux
  // Clean up any prior .waiting file
  const waitingFile = stageWaitingPath(jobId, stage);
  if (existsSync(waitingFile)) {
    try {
      unlinkSync(waitingFile);
    } catch {
      /* ignore */
    }
  }
}

function markStageWaiting(
  jobId: string,
  stage: string,
  reason: string
): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const p = stageWaitingPath(jobId, stage);
  const tmp = p + ".tmp";
  writeFileSync(
    tmp,
    JSON.stringify({
      reason,
      waitingSince: new Date().toISOString(),
      retryAfterMs: STAGE_RETRY_COOLDOWN_MS,
    })
  );
  renameSync(tmp, p);
}

function isStageInCooldown(jobId: string, stage: string): boolean {
  const waitingFile = stageWaitingPath(jobId, stage);
  if (!existsSync(waitingFile)) return false;
  try {
    const data = JSON.parse(readFileSync(waitingFile, "utf8"));
    const waitingSince = new Date(data.waitingSince).getTime();
    const cooldownMs = data.retryAfterMs ?? STAGE_RETRY_COOLDOWN_MS;
    const elapsed = Date.now() - waitingSince;
    if (elapsed < cooldownMs) {
      const remaining = Math.round((cooldownMs - elapsed) / 1000);
      log(
        `[backoff] job ${jobId} stage ${stage}: cooldown ${remaining}s remaining`
      );
      return true;
    }
    // Cooldown expired, remove waiting file
    try {
      unlinkSync(waitingFile);
    } catch {
      /* ignore */
    }
    return false;
  } catch {
    return false;
  }
}

function readStageData(
  jobId: string,
  stage: string
): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(stageLockPath(jobId, stage), "utf8"));
  } catch {
    return {};
  }
}

// ── On-chain budget check ───────────────────────────────────────────────

type OnChainBudget = {
  hasBudget: boolean;
  budgetAtomic: string;
  budgetUsdc: string;
  raw: Record<string, unknown>;
};

function atomicToUsdc(atomic: string): string {
  const n = BigInt(atomic);
  const intPart = n / 1_000_000n;
  const fracPart = n % 1_000_000n;
  if (fracPart === 0n) return intPart.toString();
  return `${intPart}.${fracPart.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

async function checkOnChainBudget(jobId: string): Promise<OnChainBudget> {
  const onchain = (await runnerPost("/jobs/onchain-status", {
    jobId,
  })) as Record<string, unknown>;
  const raw = (onchain["raw"] as Record<string, unknown>) ?? {};
  // Console MCP top-level fields: hasBudget (boolean), statusCode, statusLabel
  // raw fields: budget (atomic string, may be stale from indexer)
  const topLevelHasBudget = onchain["hasBudget"] === true;
  const budgetFromRaw = String(raw["budget"] ?? "0");
  const budgetAtomic = topLevelHasBudget
    ? (budgetFromRaw !== "0" && budgetFromRaw !== "0n" ? budgetFromRaw : "1")
    : budgetFromRaw;
  const hasBudget = topLevelHasBudget || (budgetAtomic !== "0" && budgetAtomic !== "0n" && budgetAtomic !== "");
  return {
    hasBudget,
    budgetAtomic,
    budgetUsdc: hasBudget && budgetAtomic !== "1" ? atomicToUsdc(budgetAtomic) : (hasBudget ? "unknown" : "0"),
    raw,
  };
}

function markOnChainExisting(
  jobId: string,
  budgetAtomic: string,
  budgetUsdc: string
): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const p = join(STATE_DIR, `job-${jobId}-set-budget.onchain.json`);
  const tmp = p + ".tmp";
  writeFileSync(
    tmp,
    JSON.stringify({
      stage: "set_budget",
      source: "onchain_existing",
      budgetAtomic,
      budgetUsdc,
      next: "waiting_for_funding",
      timestamp: new Date().toISOString(),
    })
  );
  renameSync(tmp, p);
}

function isOnChainExisting(jobId: string): boolean {
  return existsSync(join(STATE_DIR, `job-${jobId}-set-budget.onchain.json`));
}

// ── Job Lifecycle Processing ──────────────────────────────────────────────

async function processJob(job: IndexerJob): Promise<StageResult> {
  const jobId = job.id;

  // Terminal statuses — skip entirely
  if (job.status >= 3) {
    return {
      stage: "skip",
      status: "skipped",
      detail: `terminal status ${job.statusLabel}`,
    };
  }

  // ── Status: Open (0) ──
  if (job.status === 0) {
    if (isStageDone(jobId, "set_budget")) {
      return {
        stage: "set_budget",
        status: "skipped",
        detail: "budget already set, waiting for client fund",
      };
    }

    // Cooldown check
    if (isStageInCooldown(jobId, "set_budget")) {
      return {
        stage: "set_budget",
        status: "waiting",
        detail: "in cooldown, will retry later",
      };
    }

    // Check on-chain budget — if already set, skip setBudget entirely
    if (isOnChainExisting(jobId)) {
      return {
        stage: "set_budget",
        status: "skipped",
        detail: "budget already set on-chain (previous check)",
      };
    }

    const budgetCheck = await checkOnChainBudget(jobId);
    if (budgetCheck.hasBudget) {
      markOnChainExisting(jobId, budgetCheck.budgetAtomic, budgetCheck.budgetUsdc);
      log(
        `[live] job ${jobId}: budget already on-chain (atomic=${budgetCheck.budgetAtomic}, usdc=${budgetCheck.budgetUsdc}), skipping setBudget`
      );
      return {
        stage: "set_budget",
        status: "skipped",
        detail: `budget already on-chain: ${budgetCheck.budgetUsdc} USDC (atomic ${budgetCheck.budgetAtomic}), waiting_for_funding`,
      };
    }

    // DRAIN MODE — log only, no writes
    if (DRAIN_MODE) {
      log(
        `[drain] job ${jobId}: would set budget ${EFFECTIVE_BUDGET} USDC (requested ${REQUESTED_BUDGET})`
      );
      return {
        stage: "set_budget",
        status: "skipped",
        detail: `[drain] would set budget ${EFFECTIVE_BUDGET} USDC`,
      };
    }

    // Set budget (clamped)
    log(
      `[live] job ${jobId}: setting budget ${EFFECTIVE_BUDGET} USDC (requested ${REQUESTED_BUDGET}, cap ${MAX_BUDGET})`
    );
    try {
      const result = (await runnerPost("/erc8183/provider/set-budget", {
        jobId,
        amount: EFFECTIVE_BUDGET,
        complexity: "low",
        reason: `autonomous provider ${AGENT_ID} budget for job ${jobId}`,
      })) as Record<string, unknown>;

      // P2 fix: only mark done when result is genuinely ok
      const resultOk = result["ok"] !== false;
      const txHash = String(
        result["txHash"] ??
          (result["receipt"] as Record<string, unknown>)?.["txHash"] ??
          ""
      );
      const operationState = String(
        (result["receipt"] as Record<string, unknown>)?.["operationState"] ?? ""
      );

      if (!resultOk || operationState === "failed") {
        const failMsg = String(result["error"] ?? result["message"] ?? "setBudget returned ok=false");
        log(`[live] job ${jobId}: set_budget returned not-ok (${failMsg}), writing .waiting`);
        markStageWaiting(jobId, "set_budget", failMsg);
        return {
          stage: "set_budget",
          status: "waiting",
          detail: `Runner returned not-ok: ${failMsg}`,
        };
      }

      markStageDone(jobId, "set_budget", {
        txHash,
        amount: EFFECTIVE_BUDGET,
        originalRequested: REQUESTED_BUDGET,
        maxCap: MAX_BUDGET,
      });
      log(`[live] job ${jobId}: budget set, tx=${txHash || "(no txHash)"}`);
      return {
        stage: "set_budget",
        status: "done",
        detail: `budget ${EFFECTIVE_BUDGET} USDC`,
        txHash,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // IDEMPOTENCY_CONFLICT → already set (mark done)
      if (
        msg.includes("IDEMPOTENCY_CONFLICT") ||
        msg.includes("idempotency")
      ) {
        markStageDone(jobId, "set_budget", {
          note: "idempotency conflict — already set",
        });
        log(
          `[live] job ${jobId}: budget already set (idempotency), marking done`
        );
        return {
          stage: "set_budget",
          status: "done",
          detail: "budget already set (idempotency)",
        };
      }

      // OPERATION_IN_PROGRESS / LOCK_CONFLICT → waiting with cooldown
      if (
        msg.includes("OPERATION_IN_PROGRESS") ||
        msg.includes("LOCK_CONFLICT")
      ) {
        markStageWaiting(
          jobId,
          "set_budget",
          msg.includes("OPERATION_IN_PROGRESS")
            ? "OPERATION_IN_PROGRESS"
            : "LOCK_CONFLICT"
        );
        log(
          `[live] job ${jobId}: set_budget blocked (${msg.includes("OPERATION_IN_PROGRESS") ? "op_in_progress" : "lock_conflict"}), waiting with ${STAGE_RETRY_COOLDOWN_MS}ms cooldown`
        );
        return {
          stage: "set_budget",
          status: "waiting",
          detail: `operation in progress, cooldown ${STAGE_RETRY_COOLDOWN_MS}ms`,
        };
      }

      // Re-read on-chain budget — contract may have accepted the tx despite error
      const recheck = await checkOnChainBudget(jobId);
      if (recheck.hasBudget) {
        markOnChainExisting(jobId, recheck.budgetAtomic, recheck.budgetUsdc);
        log(
          `[live] job ${jobId}: set_budget reverted but budget is on-chain (atomic=${recheck.budgetAtomic}, usdc=${recheck.budgetUsdc}), treating as existing`
        );
        return {
          stage: "set_budget",
          status: "skipped",
          detail: `budget appeared on-chain after revert: ${recheck.budgetUsdc} USDC`,
        };
      }

      markStageWaiting(jobId, "set_budget", msg);
      log(`[live] job ${jobId}: set_budget FAILED: ${msg}`);
      return { stage: "set_budget", status: "failed", detail: msg };
    }
  }

  // ── Status: Funded (1) ──
  if (job.status === 1) {
    // Step 1: run_only
    if (!isStageDone(jobId, "run_only")) {
      // Cooldown check
      if (isStageInCooldown(jobId, "run_only")) {
        return {
          stage: "run_only",
          status: "waiting",
          detail: "in cooldown, will retry later",
        };
      }

      // DRAIN MODE
      if (DRAIN_MODE) {
        log(`[drain] job ${jobId}: would run_only`);
        return {
          stage: "run_only",
          status: "skipped",
          detail: "[drain] would run_only",
        };
      }

      log(`[live] job ${jobId}: running (run_only)`);
      try {
        const result = (await runnerPost("/erc8183/provider/run-only", {
          jobId,
          taskId: `live-${jobId}`,
          agentId: AGENT_ID,
          provider: PROVIDER_WALLET,
          task: job.description || `Process ERC-8183 job ${jobId}`,
          description: job.description || `Process ERC-8183 job ${jobId}`,
          acceptanceCriteria: [
            {
              id: "deliver",
              description: "Produce deliverable",
              mandatory: true,
            },
          ],
          commercialTerms: {
            proposedBudgetUsdc: EFFECTIVE_BUDGET,
            clientWillFund: true,
          },
        })) as Record<string, unknown>;

        const deliverableHash = String(result["deliverableHash"] ?? "");
        markStageDone(jobId, "run_only", { deliverableHash });
        log(
          `[live] job ${jobId}: run_only done, hash=${deliverableHash || "(none)"}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // IDEMPOTENCY_CONFLICT → treat as done
        if (
          msg.includes("IDEMPOTENCY_CONFLICT") ||
          msg.includes("idempotency")
        ) {
          markStageDone(jobId, "run_only", {
            note: "idempotency conflict — already run",
          });
          log(
            `[live] job ${jobId}: run_only already done (idempotency), marking done`
          );
        } else if (
          msg.includes("OPERATION_IN_PROGRESS") ||
          msg.includes("LOCK_CONFLICT")
        ) {
          markStageWaiting(
            jobId,
            "run_only",
            msg.includes("OPERATION_IN_PROGRESS")
              ? "OPERATION_IN_PROGRESS"
              : "LOCK_CONFLICT"
          );
          log(
            `[live] job ${jobId}: run_only blocked, waiting with cooldown`
          );
          return {
            stage: "run_only",
            status: "waiting",
            detail: `operation in progress, cooldown ${STAGE_RETRY_COOLDOWN_MS}ms`,
          };
        } else {
          log(`[live] job ${jobId}: run_only FAILED: ${msg}`);
          return { stage: "run_only", status: "failed", detail: msg };
        }
      }
    }

    // Step 2: submit (only after run_only succeeded)
    if (isStageDone(jobId, "run_only") && !isStageDone(jobId, "submit")) {
      // Cooldown check
      if (isStageInCooldown(jobId, "submit")) {
        return {
          stage: "submit",
          status: "waiting",
          detail: "in cooldown, will retry later",
        };
      }

      const runData = readStageData(jobId, "run_only");
      const deliverableHash = String(runData["deliverableHash"] ?? "");

      if (!deliverableHash) {
        return {
          stage: "submit",
          status: "failed",
          detail: "no deliverableHash from run_only",
        };
      }

      // DRAIN MODE
      if (DRAIN_MODE) {
        log(
          `[drain] job ${jobId}: would submit deliverable ${deliverableHash.slice(0, 16)}...`
        );
        return {
          stage: "submit",
          status: "skipped",
          detail: "[drain] would submit deliverable",
        };
      }

      log(`[live] job ${jobId}: submitting deliverable`);
      try {
        const result = (await runnerPost(
          "/erc8183/provider/submit-deliverable",
          {
            jobId,
            agentId: AGENT_ID,
            providerAddress: PROVIDER_WALLET,
            deliverableHash,
            canonicalPayload: deliverableHash,
          }
        )) as Record<string, unknown>;

        const txHash = String(
          result["txHash"] ??
            (result["receipt"] as Record<string, unknown>)?.["txHash"] ??
            ""
        );
        markStageDone(jobId, "submit", { txHash, deliverableHash });
        log(
          `[live] job ${jobId}: submitted, tx=${txHash || "(no txHash)"}`
        );
        return {
          stage: "submit",
          status: "done",
          detail: "deliverable submitted",
          txHash,
          deliverableHash,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (
          msg.includes("IDEMPOTENCY_CONFLICT") ||
          msg.includes("idempotency")
        ) {
          markStageDone(jobId, "submit", {
            note: "idempotency conflict — already submitted",
          });
          log(
            `[live] job ${jobId}: submit already done (idempotency), marking done`
          );
          return {
            stage: "submit",
            status: "done",
            detail: "already submitted (idempotency)",
          };
        }

        if (
          msg.includes("OPERATION_IN_PROGRESS") ||
          msg.includes("LOCK_CONFLICT")
        ) {
          markStageWaiting(
            jobId,
            "submit",
            msg.includes("OPERATION_IN_PROGRESS")
              ? "OPERATION_IN_PROGRESS"
              : "LOCK_CONFLICT"
          );
          log(`[live] job ${jobId}: submit blocked, waiting with cooldown`);
          return {
            stage: "submit",
            status: "waiting",
            detail: `operation in progress, cooldown ${STAGE_RETRY_COOLDOWN_MS}ms`,
          };
        }

        log(`[live] job ${jobId}: submit FAILED: ${msg}`);
        return { stage: "submit", status: "failed", detail: msg };
      }
    }

    if (isStageDone(jobId, "run_only") && isStageDone(jobId, "submit")) {
      return {
        stage: "submit",
        status: "skipped",
        detail: "fully submitted",
      };
    }
    return { stage: "run_only", status: "waiting", detail: "pending" };
  }

  // ── Status: Submitted (2) ──
  return {
    stage: "skip",
    status: "skipped",
    detail: "already submitted on-chain",
  };
}

// ── Logging ───────────────────────────────────────────────────────────────

function log(msg: string): void {
  process.stdout.write(`${new Date().toISOString()} ${msg}\n`);
}

// ── Main Loop ─────────────────────────────────────────────────────────────

let shuttingDown = false;

export async function runLiveDriver(): Promise<void> {
  if (!RUNNER_SECRET) {
    log("[live] ERROR: ARCLAYER_RUNNER_SECRET required");
    process.exit(1);
  }
  if (!AGENT_ID) {
    log("[live] ERROR: ARCLAYER_AGENT_ID required");
    process.exit(1);
  }
  if (!PROVIDER_WALLET) {
    log("[live] ERROR: CIRCLE_WALLET_ADDRESS required");
    process.exit(1);
  }

  mkdirSync(STATE_DIR, { recursive: true });

  log("[live] deterministic provider driver v2 started");
  if (DRAIN_MODE) {
    log("[live] *** DRAIN MODE — no writes will be performed ***");
  }
  log(`  runner: ${RUNNER_URL}`);
  log(`  indexer: ${INDEXER_URL}`);
  log(`  agent: ${AGENT_ID}`);
  log(`  wallet: ${PROVIDER_WALLET}`);
  log(`  requested budget: ${REQUESTED_BUDGET} USDC`);
  log(`  max budget cap: ${MAX_BUDGET} USDC`);
  log(`  effective budget: ${EFFECTIVE_BUDGET} USDC`);
  log(`  poll: ${POLL_INTERVAL_MS}ms`);
  log(`  cooldown: ${STAGE_RETRY_COOLDOWN_MS}ms`);
  log(`  state: ${STATE_DIR}`);
  log(`  drain mode: ${DRAIN_MODE}`);

  try {
    const health = (await runnerGet("/health")) as Record<string, unknown>;
    log(
      `[live] runner health: ok=${health["ok"]}, agentId=${health["agentId"]}`
    );
  } catch (err) {
    log(`[live] WARNING: runner health check failed: ${err}`);
  }

  while (!shuttingDown) {
    try {
      const jobs = await fetchJobsFromIndexer();

      if (jobs.length === 0) {
        log("[live] idle: no active jobs");
      } else {
        log(`[live] found ${jobs.length} active job(s)`);
        // Process only ONE job per cycle to avoid wallet lock conflicts
        for (const job of jobs) {
          if (shuttingDown) break;
          try {
            const result = await processJob(job);
            log(
              `[live] job ${job.id}: ${result.stage} → ${result.status} — ${result.detail}`
            );
            // If we did a write (done/failed) or are waiting, stop for this cycle
            if (
              result.status === "done" ||
              result.status === "failed" ||
              result.status === "waiting"
            ) {
              log(
                `[live] cycle action for job ${job.id} (${result.status}), ending cycle`
              );
              break;
            }
          } catch (err) {
            log(
              `[live] job ${job.id}: UNEXPECTED: ${err instanceof Error ? err.message : err}`
            );
            break;
          }
        }
      }
    } catch (err) {
      log(
        `[live] poll error: ${err instanceof Error ? err.message : err}`
      );
    }

    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, POLL_INTERVAL_MS);
      if (shuttingDown) {
        clearTimeout(t);
        resolve();
      }
    });
  }

  log("[live] driver stopped");
}

process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});
