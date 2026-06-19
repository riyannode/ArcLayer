/**
 * Deterministic Live Provider Driver v3 — Direct Mode
 *
 * Production provider runtime. No Runner dependency.
 * Uses local LLM service + Circle Dev Wallet adapter for direct on-chain writes.
 *
 * State machine per job:
 *   Open (no budget)     → set_budget once (if PROVIDER_ALLOW_SET_BUDGET=true) → done
 *   Open (budget set)    → skip → waiting for client fund
 *   Funded               → run local service → submit deliverableHash → done
 *   Submitted/Completed  → skip → terminal
 *   Rejected/Expired     → skip → terminal
 *
 * Environment:
 *   CIRCLE_API_KEY             — Circle API key
 *   CIRCLE_ENTITY_SECRET       — Circle entity secret
 *   CIRCLE_WALLET_ID           — Circle wallet ID
 *   CIRCLE_WALLET_ADDRESS      — Provider wallet address
 *   ARC_ERC8183_CONTRACT       — ERC-8183 contract address
 *   ARC_RPC_URL                — Arc RPC URL (default: https://rpc.testnet.arc.network)
 *   INDEXER_URL                — Local indexer (default http://localhost:3535)
 *   ARCLAYER_AGENT_ID          — ERC-8004 tokenId
 *   PROVIDER_WRITE_MODE        — "direct" (default)
 *   PROVIDER_ALLOW_SET_BUDGET  — "true" to enable setBudget (default: false)
 *   LIVE_POLL_INTERVAL_MS      — Poll interval (default 30000)
 *   PROVIDER_LIVE_DRAIN_MODE   — If "true", log-only, no writes (default "false")
 *   PROVIDER_STAGE_RETRY_COOLDOWN_MS — Cooldown before retrying waiting stages (default 120000)
 */

import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { runProviderService } from "./provider-service.js";
import type { ProviderWriteAdapter } from "./provider-write-adapter.js";
import { ProviderWriteCircle } from "./provider-write-circle.js";

// ── Env validation ────────────────────────────────────────────────────────

function readPositiveIntEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${name} must be a finite integer >= ${min}, got \"${raw}\"`);
  }
  return value;
}

const AGENT_ID = process.env.ARCLAYER_AGENT_ID ?? "";
const PROVIDER_WALLET = (process.env.CIRCLE_WALLET_ADDRESS ?? "").toLowerCase();
const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:3535";
const POLL_INTERVAL_MS = readPositiveIntEnv("LIVE_POLL_INTERVAL_MS", 30000, 5000);
const DRAIN_MODE = process.env.PROVIDER_LIVE_DRAIN_MODE === "true";
const ALLOW_SET_BUDGET = process.env.PROVIDER_ALLOW_SET_BUDGET === "true";
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

// ── Inbox Client ─────────────────────────────────────────────────────────

type InboxItem = {
  id: string;
  providerWallet: string;
  agentId?: string;
  jobId: string;
  eventKind: string;
  action: "set_budget" | "run_and_submit" | "observe" | "skip";
  status: string;
  priority: number;
  leaseId?: string;
  lockedBy?: string;
  lockedAt?: string;
  payloadJson?: unknown;
  createdAt: string;
  updatedAt: string;
  expiryAt: string;
};

async function inboxClaim(): Promise<InboxItem | null> {
  try {
    const res = await fetch(`${INDEXER_URL}/provider/inbox/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: PROVIDER_WALLET,
        agentId: AGENT_ID,
        limit: 1,
        leaseMs: 120_000,
        waitMs: 30_000,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; item?: InboxItem };
    return data.ok && data.item ? data.item : null;
  } catch {
    return null;
  }
}

async function inboxComplete(
  id: string,
  leaseId: string,
  jobId: string,
  result?: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${INDEXER_URL}/provider/inbox/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, leaseId, jobId, result }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // non-fatal
  }
}

async function inboxFail(
  id: string,
  leaseId: string,
  error: string,
  retryAfterMs?: number,
): Promise<void> {
  try {
    await fetch(`${INDEXER_URL}/provider/inbox/fail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, leaseId, error, retryAfterMs }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // non-fatal
  }
}

async function inboxReconcile(): Promise<void> {
  try {
    const res = await fetch(`${INDEXER_URL}/provider/inbox/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: PROVIDER_WALLET }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { enqueued?: number; staleMarked?: number };
      if ((data.enqueued ?? 0) > 0 || (data.staleMarked ?? 0) > 0) {
        log(`[provider-inbox] reconcile: enqueued=${data.enqueued} stale=${data.staleMarked}`);
      }
    }
  } catch {
    // non-fatal
  }
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
  data: Record<string, unknown>,
): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const p = stageLockPath(jobId, stage);
  const tmp = p + ".tmp";
  writeFileSync(
    tmp,
    JSON.stringify({ ...data, completedAt: new Date().toISOString() }),
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

function markStageWaiting(jobId: string, stage: string, reason: string): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const p = stageWaitingPath(jobId, stage);
  const tmp = p + ".tmp";
  writeFileSync(
    tmp,
    JSON.stringify({
      reason,
      waitingSince: new Date().toISOString(),
      retryAfterMs: STAGE_RETRY_COOLDOWN_MS,
    }),
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
        `[backoff] job ${jobId} stage ${stage}: cooldown ${remaining}s remaining`,
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
  stage: string,
): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(stageLockPath(jobId, stage), "utf8"));
  } catch {
    return {};
  }
}

// ── Logging ───────────────────────────────────────────────────────────────

function log(msg: string): void {
  process.stdout.write(`${new Date().toISOString()} ${msg}\n`);
}

// ── Main Loop ─────────────────────────────────────────────────────────────

let shuttingDown = false;

export async function runLiveDriver(): Promise<void> {
  if (!AGENT_ID) {
    log("[live] ERROR: ARCLAYER_AGENT_ID required");
    process.exit(1);
  }
  if (!PROVIDER_WALLET) {
    log("[live] ERROR: CIRCLE_WALLET_ADDRESS required");
    process.exit(1);
  }

  // Initialize write adapter (Circle SDK)
  let writeAdapter: ProviderWriteAdapter;
  try {
    writeAdapter = new ProviderWriteCircle();
  } catch (err) {
    log(`[live] ERROR: failed to initialize provider write adapter: ${err}`);
    process.exit(1);
  }

  mkdirSync(STATE_DIR, { recursive: true });

  log("[live] deterministic provider driver v3 — DIRECT MODE");
  log("[live]   no Runner dependency");
  if (DRAIN_MODE) {
    log("[live]   *** DRAIN MODE — no writes will be performed ***");
  }
  log(`  indexer: ${INDEXER_URL}`);
  log(`  agent: ${AGENT_ID}`);
  log(`  wallet: ${PROVIDER_WALLET}`);
  log(`  contract: ${process.env.ARC_ERC8183_CONTRACT ?? "(from env)"}`);
  log(`  allow setBudget: ${ALLOW_SET_BUDGET}`);
  log(`  poll: ${POLL_INTERVAL_MS}ms`);
  log(`  cooldown: ${STAGE_RETRY_COOLDOWN_MS}ms`);
  log(`  state: ${STATE_DIR}`);
  log(`  drain mode: ${DRAIN_MODE}`);

  // ── Reconcile timer (low-frequency fallback every 5 min) ─────────────
  const RECONCILE_INTERVAL_MS = 5 * 60_000;
  let lastReconcile = 0;

  while (!shuttingDown) {
    try {
      // Periodic reconcile from indexer state (catches missed inbox rows)
      const now = Date.now();
      if (now - lastReconcile > RECONCILE_INTERVAL_MS) {
        await inboxReconcile();
        lastReconcile = now;
      }

      // Claim one actionable item from inbox
      const item = await inboxClaim();

      if (!item) {
        log("[live] idle: no pending inbox items");
      } else {
        log(
          `[provider-inbox] claim job=${item.jobId} action=${item.action} lease=${item.leaseId} priority=${item.priority}`,
        );

        if (DRAIN_MODE) {
          log(`[drain] job ${item.jobId}: would execute ${item.action}`);
          await inboxComplete(item.id, item.leaseId!, item.jobId, {
            drain: true,
          });
          continue;
        }

        if (item.action === "set_budget") {
          // ── Set Budget ─────────────────────────────────────────────────
          if (!ALLOW_SET_BUDGET) {
            log(
              `[provider-inbox] skip job=${item.jobId} action=set_budget (PROVIDER_ALLOW_SET_BUDGET=false)`,
            );
            await inboxComplete(item.id, item.leaseId!, item.jobId, {
              skipped: "set_budget_disabled",
            });
            continue;
          }

          const jobId = item.jobId;
          if (isStageDone(jobId, "set_budget")) {
            log(
              `[provider-inbox] complete job=${jobId} action=set_budget (already done)`,
            );
            await inboxComplete(item.id, item.leaseId!, jobId, {
              skipped: "already_done",
            });
            continue;
          }

          if (isStageInCooldown(jobId, "set_budget")) {
            log(
              `[provider-inbox] fail job=${jobId} action=set_budget (cooldown)`,
            );
            await inboxFail(
              item.id,
              item.leaseId!,
              "in cooldown",
              STAGE_RETRY_COOLDOWN_MS,
            );
            continue;
          }

          // Check on-chain budget
          const budgetCheck = await writeAdapter.checkOnChainBudget(jobId);
          if (budgetCheck.hasBudget) {
            markStageDone(jobId, "set_budget", {
              source: "onchain_existing",
              budgetUsdc: budgetCheck.budgetUsdc,
            });
            await inboxComplete(item.id, item.leaseId!, jobId, {
              skipped: "budget_on_chain",
              budgetUsdc: budgetCheck.budgetUsdc,
            });
            continue;
          }

          // setBudget via adapter
          if (!writeAdapter.setBudget) {
            log(`[live] job ${jobId}: setBudget not available on adapter`);
            await inboxFail(
              item.id,
              item.leaseId!,
              "setBudget not available",
              STAGE_RETRY_COOLDOWN_MS,
            );
            continue;
          }

          const budgetAmount =
            process.env.LIVE_PROVIDER_BUDGET_USDC ?? "0.01";
          log(
            `[live] job ${jobId}: setting budget ${budgetAmount} USDC via Circle adapter`,
          );

          const result = await writeAdapter.setBudget({
            jobId,
            amount: budgetAmount,
            reason: `provider ${AGENT_ID} budget for job ${jobId}`,
          });

          if (result.ok) {
            markStageDone(jobId, "set_budget", {
              txHash: result.txHash ?? "confirmed",
              amount: budgetAmount,
            });
            log(`[live] job ${jobId}: budget set, tx=${result.txHash ?? "confirmed"}`);
            await inboxComplete(item.id, item.leaseId!, jobId, {
              txHash: result.txHash,
            });
          } else {
            log(`[live] job ${jobId}: set_budget FAILED: ${result.error}`);
            markStageWaiting(jobId, "set_budget", result.error ?? "unknown");
            await inboxFail(
              item.id,
              item.leaseId!,
              result.error ?? "setBudget failed",
              STAGE_RETRY_COOLDOWN_MS,
            );
          }
        } else if (item.action === "run_and_submit") {
          // ── Run + Submit ───────────────────────────────────────────────
          const jobId = item.jobId;
          if (isStageDone(jobId, "submit")) {
            log(
              `[provider-inbox] complete job=${jobId} action=run_and_submit (already submitted)`,
            );
            await inboxComplete(item.id, item.leaseId!, jobId, {
              skipped: "already_submitted",
            });
            continue;
          }

          // Step 1: Run local provider service
          if (!isStageDone(jobId, "run_only")) {
            if (isStageInCooldown(jobId, "run_only")) {
              await inboxFail(
                item.id,
                item.leaseId!,
                "run_only in cooldown",
                STAGE_RETRY_COOLDOWN_MS,
              );
              continue;
            }

            log(`[live] job ${jobId}: running local provider service`);
            try {
              const jobData =
                (item.payloadJson as Record<string, unknown>) ?? {};
              const prompt =
                (jobData["description"] as string) ??
                (jobData["input"] as string) ??
                `Process job ${jobId} and generate a deliverable.`;

              const serviceResult = await runProviderService({
                jobId,
                prompt,
                agentId: AGENT_ID,
              });

              markStageDone(jobId, "run_only", {
                deliverableHash: serviceResult.deliverableHash,
              });
              log(
                `[live] job ${jobId}: run_only done, hash=${serviceResult.deliverableHash.slice(0, 18)}...`,
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              log(`[live] job ${jobId}: run_only ERROR: ${msg}`);
              markStageWaiting(jobId, "run_only", msg);
              await inboxFail(
                item.id,
                item.leaseId!,
                `run_only: ${msg}`,
                STAGE_RETRY_COOLDOWN_MS,
              );
              continue;
            }
          }

          // Step 2: Submit deliverableHash directly via Circle adapter
          if (!isStageDone(jobId, "submit")) {
            if (isStageInCooldown(jobId, "submit")) {
              await inboxFail(
                item.id,
                item.leaseId!,
                "submit in cooldown",
                STAGE_RETRY_COOLDOWN_MS,
              );
              continue;
            }

            const runData = readStageData(jobId, "run_only");
            const deliverableHash = runData["deliverableHash"] as
              | `0x${string}`
              | undefined;

            if (!deliverableHash) {
              await inboxFail(
                item.id,
                item.leaseId!,
                "no deliverableHash from run_only",
                STAGE_RETRY_COOLDOWN_MS,
              );
              continue;
            }

            log(
              `[live] job ${jobId}: submitting deliverable via Circle adapter`,
            );
            try {
              const submitResult = await writeAdapter.submit({
                jobId,
                deliverableHash,
                agentId: AGENT_ID,
              });

              if (submitResult.ok) {
                markStageDone(jobId, "submit", {
                  txHash: submitResult.txHash ?? "confirmed",
                  deliverableHash,
                });
                log(
                  `[live] job ${jobId}: submitted, tx=${submitResult.txHash ?? "confirmed"}`,
                );
                await inboxComplete(item.id, item.leaseId!, jobId, {
                  txHash: submitResult.txHash,
                  deliverableHash,
                });
              } else {
                log(
                  `[live] job ${jobId}: submit FAILED: ${submitResult.error}`,
                );
                markStageWaiting(
                  jobId,
                  "submit",
                  submitResult.error ?? "unknown",
                );
                await inboxFail(
                  item.id,
                  item.leaseId!,
                  `submit: ${submitResult.error}`,
                  STAGE_RETRY_COOLDOWN_MS,
                );
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              log(`[live] job ${jobId}: submit ERROR: ${msg}`);
              markStageWaiting(jobId, "submit", msg);
              await inboxFail(
                item.id,
                item.leaseId!,
                `submit: ${msg}`,
                STAGE_RETRY_COOLDOWN_MS,
              );
            }
          }
        } else {
          // observe / skip — complete immediately
          log(
            `[provider-inbox] complete job=${item.jobId} action=${item.action} (observed/skipped)`,
          );
          await inboxComplete(item.id, item.leaseId!, item.jobId, {
            observed: true,
          });
        }
      }
    } catch (err) {
      log(
        `[live] poll error: ${err instanceof Error ? err.message : err}`,
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
