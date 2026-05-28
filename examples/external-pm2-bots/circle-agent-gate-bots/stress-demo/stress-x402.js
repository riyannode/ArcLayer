#!/usr/bin/env node
/**
 * x402 Circle Gateway Stress Test
 * 
 * Runs x402 payments at configurable interval (default 1s).
 * Separate from LLM reasoning loop.
 * 
 * Usage:
 *   PAY_INTERVAL=1000 MAX_PAYMENTS=0 node stress-x402.js
 *   PAY_INTERVAL=500  MAX_PAYMENTS=100 node stress-x402.js  # 500ms, stop after 100
 */

require("dotenv").config();

const { payUpstreamForAccess } = require("../shared/pay-upstream");
const { postBridgeEvent } = require("../shared/arclayer-api");
const { resolveCommerceRoute } = require("../shared/commerce-route-map");

// ─── Config ──────────────────────────────────────────────────────────

const PAY_INTERVAL = parseInt(process.env.PAY_INTERVAL || "1000", 10); // ms between payments
const MAX_PAYMENTS = parseInt(process.env.MAX_PAYMENTS || "0", 10);    // 0 = infinite
const ROLE = process.env.AGENT_ROLE || "analyzer";
const UPSTREAM_ID = process.env.UPSTREAM_AGENT_ID;
const UPSTREAM_ROLE = process.env.UPSTREAM_ROLE || "oracle";
const MARKET = process.env.MARKET_ID || "btc-15m";
const CATEGORY = process.env.AGENT_CATEGORY || "prediction-market-bots";
const RUNTIME_ID = process.env.RUNTIME_ID || `circle-commerce-${ROLE}-01`;
const ACCESS_TYPE = process.env.ACCESS_TYPE || "market_data";
const STRESS_SESSION = `stress_${ROLE}_${Date.now()}`; // unique per run

// ─── Metrics ─────────────────────────────────────────────────────────

const metrics = {
  total: 0,
  success: 0,
  failed: 0,
  latencies: [],
  startTime: Date.now(),
};

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function report() {
  const elapsed = ((Date.now() - metrics.startTime) / 1000).toFixed(1);
  const avg = metrics.latencies.length > 0
    ? (metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length).toFixed(0)
    : 0;
  const p50 = percentile(metrics.latencies, 50);
  const p95 = percentile(metrics.latencies, 95);
  const p99 = percentile(metrics.latencies, 99);
  const tps = metrics.total > 0
    ? (metrics.total / (elapsed / 1000)).toFixed(2)
    : 0;

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║         x402 STRESS TEST RESULTS             ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  Duration:     ${elapsed}s`);
  console.log(`║  Total:        ${metrics.total}`);
  console.log(`║  Success:      ${metrics.success}`);
  console.log(`║  Failed:       ${metrics.failed}`);
  console.log(`║  TPS:          ${tps} tx/s`);
  console.log(`║  Interval:     ${PAY_INTERVAL}ms`);
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  Latency avg:  ${avg}ms`);
  console.log(`║  Latency p50:  ${p50}ms`);
  console.log(`║  Latency p95:  ${p95}ms`);
  console.log(`║  Latency p99:  ${p99}ms`);
  console.log(`║  Latency min:  ${metrics.latencies.length > 0 ? Math.min(...metrics.latencies) : 0}ms`);
  console.log(`║  Latency max:  ${metrics.latencies.length > 0 ? Math.max(...metrics.latencies) : 0}ms`);
  console.log("╚══════════════════════════════════════════════╝\n");
}

// ─── Payment Loop ────────────────────────────────────────────────────

async function runPayment(i) {
  const start = Date.now();
  // Each payment gets a unique session to avoid "already_paid"
  const sessionId = `${STRESS_SESSION}_${i}`;
  try {
    // Create bridge event first (required for commerce gate)
    const eventType = ROLE === "oracle" ? "market_snapshot" : "bridge_event";
    await postBridgeEvent({
      sessionId,
      category: CATEGORY,
      role: ROLE,
      type: eventType,
      runtimeId: RUNTIME_ID,
      payload: { stress_test: true, iteration: i, timestamp: new Date().toISOString() },
    });

    await payUpstreamForAccess({
      upstreamAgentId: UPSTREAM_ID,
      upstreamRole: UPSTREAM_ROLE,
      buyerRole: ROLE,
      category: CATEGORY,
      market: MARKET,
      sessionId,
      runtimeId: RUNTIME_ID,
      sourcePayloadHash: `0xstress${Date.now().toString(16)}${i.toString(16).padStart(4, "0")}`,
      payload: { stress_test: true, iteration: i, timestamp: new Date().toISOString() },
    });

    const latency = Date.now() - start;
    metrics.latencies.push(latency);
    metrics.success++;
    metrics.total++;

    console.log(`[${i}] ✓ ${latency}ms (success=${metrics.success} fail=${metrics.failed})`);
  } catch (err) {
    const latency = Date.now() - start;
    metrics.latencies.push(latency);
    metrics.failed++;
    metrics.total++;

    const errMsg = err.message || String(err);
    // Truncate long errors
    const short = errMsg.length > 80 ? errMsg.slice(0, 80) + "..." : errMsg;
    console.log(`[${i}] ✗ ${latency}ms ${short}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║         x402 CIRCLE STRESS TEST              ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  Role:         ${ROLE}`);
  console.log(`║  Upstream:     ${UPSTREAM_ID || "N/A"}`);
  console.log(`║  Market:       ${MARKET}`);
  console.log(`║  Interval:     ${PAY_INTERVAL}ms`);
  console.log(`║  Max payments: ${MAX_PAYMENTS || "infinite"}`);
  console.log("╚══════════════════════════════════════════════╝\n");

  if (!UPSTREAM_ID) {
    console.error("ERROR: UPSTREAM_AGENT_ID required");
    process.exit(1);
  }

  // Graceful shutdown
  let running = true;
  process.on("SIGINT", () => {
    console.log("\n[stress] stopping...");
    running = false;
  });
  process.on("SIGTERM", () => {
    console.log("\n[stress] stopping...");
    running = false;
  });

  let i = 0;
  while (running) {
    if (MAX_PAYMENTS > 0 && i >= MAX_PAYMENTS) {
      console.log(`\n[stress] reached max payments (${MAX_PAYMENTS})`);
      break;
    }

    await runPayment(i);
    i++;

    // Wait for interval
    await new Promise((r) => setTimeout(r, PAY_INTERVAL));
  }

  report();
  process.exit(0);
}

main().catch((err) => {
  console.error("[stress] fatal:", err);
  process.exit(1);
});
