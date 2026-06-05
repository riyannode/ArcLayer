/**
 * x402 Circle Gateway Client — per-agent EOA payer for external PM2 bots.
 *
 * Uses Circle GatewayClient from @circle-fin/x402-batching/client.
 * GatewayClient handles the full 402 flow automatically:
 *   1. Makes initial request
 *   2. If 402, finds Gateway batching option
 *   3. Signs payment authorization
 *   4. Retries with Payment-Signature header
 *
 * Each bot uses its OWN private key (from env). Never shares a platform payer.
 *
 * Env vars:
 *   ARCLAYER_BASE_URL              — ArcLayer server URL
 *   ARCLAYER_AGENT_ID              — Agent ID (ERC-8004)
 *   ARCLAYER_API_KEY               — API key for auth-protected resources
 *   ARCLAYER_RUNTIME_ID            — Runtime/process identifier (optional)
 *   X402_GATEWAY_CHAIN             — 'arcTestnet' (default)
 *   X402_GATEWAY_PAYER_PRIVATE_KEY — EOA private key (NEVER commit)
 *
 * DO NOT store private keys in code, DB, or version control.
 */

const path = require("node:path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });

const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/$/, "");
const DEFAULT_RESOURCE = "/api/x402/bridge-access";
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
 * GatewayClient.pay(url, options) handles the full 402 flow:
 * - Initial request → 402 challenge → sign → retry with payment header
 * - Returns PayResult with { data, amount, formattedAmount, transaction, status }
 *
 * @param {Object} params
 * @param {string} params.resource — Resource path (e.g. '/api/x402/bridge-access')
 * @param {string} [params.method='POST'] — HTTP method
 * @param {Object} [params.body={}] — Request body
 * @param {Object} [params.headers={}] — Extra headers (e.g. Authorization)
 * @returns {Promise<Object>} Structured result with ok, payer, paymentId, etc.
 */
async function payForGatewayResource({
  resource = DEFAULT_RESOURCE,
  method = "POST",
  body = {},
  headers: extraHeaders = {},
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

  // Build headers: API key + agent context
  const headers = { ...extraHeaders };
  if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
  if (agentId) headers["x-arclayer-agent-id"] = agentId;
  if (runtimeId) headers["x-arclayer-runtime-id"] = runtimeId;

  // Create GatewayClient
  let client;
  try {
    client = await gatewayClientForAgent(privateKey);
  } catch (err) {
    return { ok: false, error: "gateway_client_init_failed", message: err.message };
  }

  // GatewayClient.pay() handles the full 402 flow:
  // 1. Makes initial request to URL
  // 2. If 402, parses challenge and finds GatewayWalletBatched option
  // 3. Signs EIP-3009 authorization against GatewayWallet contract
  // 4. Retries with PAYMENT-SIGNATURE header
  const url = `${BASE_URL}${resource}`;

  let payResult;
  try {
    payResult = await client.pay(url, {
      method,
      body: body && Object.keys(body).length > 0 ? body : undefined,
      headers,
    });
  } catch (err) {
    return { ok: false, error: "gateway_pay_failed", message: err.message };
  }

  // Parse PAYMENT-RESPONSE from response headers
  // GatewayClient returns raw Response-like; we need to extract payment info
  const data = payResult.data;
  const status = payResult.status;

  // GatewayClient may not expose response headers directly.
  // Extract what we can from the PayResult.
  const transaction = payResult.transaction || null;
  const amount = payResult.formattedAmount || String(payResult.amount || "");

  if (status >= 400) {
    return {
      ok: false,
      error: (data && data.error) || "paid_request_failed",
      status,
      message: (data && data.message) || `Paid request failed: ${status}`,
      detail: data,
    };
  }

  return {
    ok: true,
    payer: client.address,
    amount,
    transaction,
    agentId,
    runtimeId,
    sessionId,
    jobId,
    mode: "circle-gateway",
    response: data,
  };
}

module.exports = { gatewayClientForAgent, payForGatewayResource };
