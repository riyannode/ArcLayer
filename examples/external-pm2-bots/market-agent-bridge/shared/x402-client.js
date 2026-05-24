const path = require("node:path");
const crypto = require("node:crypto");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });

const { privateKeyToAccount } = require("viem/accounts");
const { getAddress } = require("viem");

const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/$/, "");
const ARC_CHAIN_ID = 5042002;
const DEFAULT_RESOURCE = "/api/x402/bridge-access";

function normalizePrivateKey(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("ISI_") || raw.includes("REPLACE")) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function base64Json(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64");
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

function randomNonce() {
  return `0x${crypto.randomBytes(32).toString("hex")}`;
}

function pickNativeRequirement(accepts) {
  if (!Array.isArray(accepts)) return null;
  return accepts.find((a) =>
    a &&
    a.scheme === "exact" &&
    String(a.network || "").includes("5042002") &&
    (!a.extra?.transferMethod || a.extra.transferMethod === "eip3009")
  ) || accepts[0] || null;
}

async function payForBridgeAccess({
  sessionId,
  scope = process.env.X402_SCOPE || "external_trace",
  resource = DEFAULT_RESOURCE,
  method = "POST",
  role = "executor"
} = {}) {
  const privateKey = normalizePrivateKey(process.env.X402_PAYER_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY);
  if (!privateKey) {
    return {
      ok: false,
      skipped: true,
      error: "missing_x402_payer_private_key",
      message: "Set X402_PAYER_PRIVATE_KEY in this bot .env to enable autonomous x402 payment."
    };
  }

  const account = privateKeyToAccount(privateKey);
  const payer = getAddress(account.address);
  const body = {
    scope,
    role,
    ...(sessionId ? { sessionId } : {})
  };

  const challengeUrl = `${BASE_URL}${resource}?rail=arc-native-eoa&payer=${encodeURIComponent(payer)}`;
  const first = await fetch(challengeUrl, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(body)
  });

  const challenge = await first.json().catch(() => ({}));
  if (first.status !== 402 || !Array.isArray(challenge.accepts)) {
    throw new Error(`x402 challenge failed: ${first.status} ${challenge.error || challenge.message || "no accepts"}`.trim());
  }

  const req = pickNativeRequirement(challenge.accepts);
  if (!req) throw new Error("x402 challenge did not return a usable Arc Native requirement");

  const accepted = {
    ...req,
    asset: getAddress(req.asset),
    payTo: getAddress(req.payTo),
    extra: {
      ...(req.extra || {}),
      name: req.extra?.name || "USDC",
      version: req.extra?.version || "2",
      decimals: req.extra?.decimals || 6,
      symbol: req.extra?.symbol || "USDC"
    }
  };

  const validAfter = "0";
  const validBefore = String(Math.floor(Date.now() / 1000) + Number(req.maxTimeoutSeconds || 300));
  const nonce = randomNonce();
  const asset = getAddress(req.asset);
  const payTo = getAddress(req.payTo);

  const signature = await account.signTypedData({
    domain: {
      name: String(accepted.extra.name || "USDC"),
      version: String(accepted.extra.version || "2"),
      chainId: ARC_CHAIN_ID,
      verifyingContract: asset
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: payer,
      to: payTo,
      value: BigInt(req.amount),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce
    }
  });

  const paymentPayload = {
    x402Version: 2,
    resource: `${BASE_URL}${resource}`,
    accepted,
    payload: {
      signature,
      authorization: {
        from: payer,
        to: payTo,
        value: String(req.amount),
        validAfter,
        validBefore,
        nonce
      }
    }
  };

  const paid = await fetch(`${BASE_URL}${resource}`, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "X-PAYMENT": base64Json(paymentPayload)
    },
    body: JSON.stringify(body)
  });

  const data = await paid.json().catch(() => ({}));
  const paymentResponse = decodePaymentResponse(paid.headers.get("payment-response") || paid.headers.get("PAYMENT-RESPONSE"));

  const responseTx = paymentResponse?.transaction || data.transaction || data.txHash || null;
  const responsePaymentId = paymentResponse?.paymentId || data.paymentId || null;
  if (data.error === "session_already_paid") {
    return {
      ok: true,
      alreadyPaid: true,
      transaction: responseTx,
      txHash: responseTx,
      paymentId: responsePaymentId,
      sessionId: data.sessionId || sessionId || null,
      scope: data.scope || scope,
      role: data.role || role
    };
  }

  if (!paid.ok || data.ok === false) {
    const err = new Error(`x402 paid request failed: ${paid.status} ${data.error || data.reason || data.message || "unknown"}`.trim());
    err.code = data.error || "x402_paid_failed";
    err.detail = { sessionId: data.sessionId || sessionId || null, scope: data.scope || scope, reason: data.reason || data.message || null };
    throw err;
  }

  return {
    ok: true,
    payer,
    payTo,
    amount: String(req.amount),
    network: req.network,
    resource,
    sessionId: data.sessionId || sessionId || null,
    payloadHash: data.payloadHash || null,
    transaction: responseTx,
    txHash: responseTx,
    paymentId: responsePaymentId,
    mode: paymentResponse?.mode || "arc-native",
    paymentResponse,
    response: data
  };
}

module.exports = { payForBridgeAccess };
