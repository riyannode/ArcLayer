/**
 * x402 Circle Gateway Client — per-agent EOA payer for external PM2 bots.
 *
 * Uses Circle GatewayClient from @circle-fin/x402-batching/client.
 * Each bot uses its OWN private key (from env). Never shares a platform payer.
 *
 * Env vars:
 *   ARCLAYER_BASE_URL              — ArcLayer server URL
 *   ARCLAYER_AGENT_ID              — Agent ID (ERC-8004)
 *   ARCLAYER_API_KEY               — API key for auth-protected resources
 *   ARCLAYER_RUNTIME_ID            — Runtime/process identifier (optional)
 *   X402_RAIL                      — 'circle-gateway' (default)
 *   X402_GATEWAY_CHAIN             — 'arcTestnet' (default)
 *   X402_GATEWAY_PAYER_PRIVATE_KEY — EOA private key (NEVER commit)
 *   X402_GATEWAY_MAX_PRICE_RAW     — Max price in atomic units (default 10000)
 *
 * Flow:
 *   1. Instantiate GatewayClient with agent's own payer EOA private key.
 *   2. Call protected resource using client.pay().
 *   3. Include API key + agent context in headers.
 *   4. Parse PAYMENT-RESPONSE.
 *   5. Return structured result.
 *
 * DO NOT store private keys in code, DB, or version control.
 */

const path = require("node:path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });

const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/$/, "");
const DEFAULT_RESOURCE = "/api/x402/bridge-access";
const MAX_PRICE_RAW = process.env.X402_GATEWAY_MAX_PRICE_RAW || "10000";
const GATEWAY_CHAIN = process.env.X402_GATEWAY_CHAIN || "arcTestnet";

function normalizePrivateKey(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("ISI_") || raw.includes("REPLACE")) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function decodePaymentResponse(header) {
  if (!header) return null;
  try {
    const normalized = header.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Create a GatewayClient instance for an agent's EOA payer.
 * @param {string} privateKey — hex private key (0x-prefixed)
 * @returns {Promise<import('@circle-fin/x402-batching/client').GatewayClient>}
 */
async function gatewayClientForAgent(privateKey) {
  const { GatewayClient } = await import("@circle-fin/x402-batching/client");
  return new GatewayClient({
    privateKey,
    chain: GATEWAY_CHAIN,
  });
}

/**
 * Pay for an x402 protected resource using Circle Gateway.
 *
 * @param {Object} params
 * @param {string} params.resource — Resource path (e.g. '/api/x402/bridge-access')
 * @param {string} [params.method='POST'] — HTTP method
 * @param {Object} [params.body={}] — Request body
 * @param {Object} [params.headers={}] — Extra headers
 * @param {string} [params.maxPriceRaw] — Max price override
 * @returns {Promise<Object>} Structured result with ok, payer, paymentId, etc.
 */
async function payForGatewayResource({
  resource = DEFAULT_RESOURCE,
  method = "POST",
  body = {},
  headers: extraHeaders = {},
  maxPriceRaw,
} = {}) {
  const privateKey = normalizePrivateKey(
    process.env.X402_GATEWAY_PAYER_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY
  );
  if (!privateKey) {
    return {
      ok: false,
      skipped: true,
      error: "missing_x402_gateway_payer_private_key",
      message: "Set X402_GATEWAY_PAYER_PRIVATE_KEY in this bot .env to enable Circle Gateway x402 payment.",
    };
  }

  const agentId = process.env.ARCLAYER_AGENT_ID || "";
  const apiKey = process.env.ARCLAYER_API_KEY || "";
  const runtimeId = process.env.ARCLAYER_RUNTIME_ID || null;
  const sessionId = body.sessionId || null;
  const jobId = body.jobId || null;

  // Step 1: Get 402 challenge
  const challengeUrl = `${BASE_URL}${resource}?rail=circle-gateway-passkey`;
  const challengeHeaders = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (apiKey) {
    challengeHeaders["authorization"] = `Bearer ${apiKey}`;
  }

  let first;
  try {
    first = await fetch(challengeUrl, {
      method,
      headers: challengeHeaders,
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: "challenge_fetch_failed", message: err.message };
  }

  if (first.status !== 402) {
    const data = await first.json().catch(() => ({}));
    // Resource may not require payment
    if (first.ok) {
      return {
        ok: true,
        alreadyPaid: true,
        payer: null,
        paymentId: null,
        transaction: null,
        agentId,
        sessionId,
        jobId,
        response: data,
      };
    }
    return {
      ok: false,
      error: data.error || "challenge_failed",
      status: first.status,
      message: data.message || `Expected 402, got ${first.status}`,
    };
  }

  const challenge = await first.json().catch(() => ({}));
  if (!Array.isArray(challenge.accepts) || challenge.accepts.length === 0) {
    return { ok: false, error: "no_accepts", message: "x402 challenge returned no payment options" };
  }

  // Step 2: Find Circle Gateway requirement
  // Server emits: extra.name='GatewayWalletBatched', extra.transferMethod='gateway-batched-eip3009', network='eip155:5042002'
  const gatewayReq = challenge.accepts.find(
    (a) =>
      a &&
      a.scheme === "exact" &&
      (a.extra?.name === "GatewayWalletBatched" ||
        a.extra?.transferMethod === "gateway-batched-eip3009")
  ) || challenge.accepts.find(
    (a) => a && a.scheme === "exact" && String(a.network || "").includes("5042002")
  );

  if (!gatewayReq) {
    return {
      ok: false,
      error: "no_gateway_requirement",
      message: "x402 challenge did not return a Circle Gateway requirement. Check allowedRails.",
    };
  }

  // Step 3: Create GatewayClient and pay
  let client;
  try {
    client = await gatewayClientForAgent(privateKey);
  } catch (err) {
    return { ok: false, error: "gateway_client_init_failed", message: err.message };
  }

  const price = maxPriceRaw || MAX_PRICE_RAW;

  // Build payment using GatewayClient
  let paymentPayload;
  try {
    paymentPayload = await client.pay(gatewayReq, price);
  } catch (err) {
    return { ok: false, error: "gateway_pay_failed", message: err.message };
  }

  // Step 4: Send paid request
  const paidHeaders = {
    "content-type": "application/json",
    accept: "application/json",
    "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(paymentPayload)).toString("base64"),
  };
  if (apiKey) {
    paidHeaders["authorization"] = `Bearer ${apiKey}`;
  }
  // Include agent context in headers
  if (agentId) paidHeaders["x-arclayer-agent-id"] = agentId;
  if (runtimeId) paidHeaders["x-arclayer-runtime-id"] = runtimeId;

  let paid;
  try {
    paid = await fetch(`${BASE_URL}${resource}`, {
      method,
      headers: paidHeaders,
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: "paid_fetch_failed", message: err.message };
  }

  const data = await paid.json().catch(() => ({}));
  const paymentResponse = decodePaymentResponse(
    paid.headers.get("payment-response") || paid.headers.get("PAYMENT-RESPONSE")
  );

  if (!paid.ok) {
    return {
      ok: false,
      error: data.error || "paid_request_failed",
      status: paid.status,
      message: data.message || `Paid request failed: ${paid.status}`,
      detail: data,
      paymentResponse,
    };
  }

  const responseTx = paymentResponse?.transaction || data.transaction || data.txHash || null;
  const responsePaymentId = paymentResponse?.paymentId || data.paymentId || null;

  return {
    ok: true,
    payer: paymentResponse?.payer || data.payer || null,
    payTo: paymentResponse?.payTo || null,
    amount: paymentResponse?.amount || null,
    transaction: responseTx,
    txHash: responseTx,
    paymentId: responsePaymentId,
    agentId: paymentResponse?.agentId || agentId,
    runtimeId: paymentResponse?.runtimeId || runtimeId,
    sessionId: paymentResponse?.sessionId || sessionId,
    jobId: paymentResponse?.jobId || jobId,
    payerVerified: paymentResponse?.payerVerified || false,
    mode: paymentResponse?.mode || "circle-gateway",
    paymentResponse,
    response: data,
  };
}

module.exports = { gatewayClientForAgent, payForGatewayResource };
