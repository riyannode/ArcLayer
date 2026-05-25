/**
 * x402 client for job settlement — builds, signs, and sends EIP-3009 payments
 * against ArcLayer settlement endpoints.
 *
 * Bounded logic extracted from examples/external-pm2-bots/market-agent-bridge/shared/x402-client.js.
 * No dependency on the PM2 bot package — self-contained with viem.
 */
const crypto = require('node:crypto');
const { privateKeyToAccount } = require('viem/accounts');
const { getAddress, isHex } = require('viem');

const ARC_CHAIN_ID = 5042002;

/**
 * Normalize a hex private key (adds 0x prefix if missing).
 * Returns empty string for placeholder/empty values.
 */
function normalizePrivateKey(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('ISI_') || raw.includes('REPLACE')) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

/**
 * Base64url-encode a JSON-serializable value for the X-PAYMENT header.
 */
function base64Json(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Decode a PAYMENT-RESPONSE header from base64url to an object.
 */
function decodePaymentResponse(header) {
  if (!header) return null;
  try {
    const normalized = String(header).replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Generate a random 32-byte nonce for EIP-3009 TransferWithAuthorization.
 */
function randomNonce() {
  return `0x${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Pick the Arc Native EIP-3009 requirement from a 402 accepts array.
 * Prefers exact-scheme entries on Arc network (eip155:5042002) with eip3009 transferMethod.
 */
function pickNativeRequirement(accepts) {
  if (!Array.isArray(accepts)) return null;
  return (
    accepts.find(
      (a) =>
        a &&
        a.scheme === 'exact' &&
        String(a.network || '').includes('5042002') &&
        (!a.extra?.transferMethod || a.extra.transferMethod === 'eip3009'),
    ) || accepts[0] || null
  );
}

/**
 * Sign an EIP-3009 TransferWithAuthorization for the given accepted payment requirement.
 * Async — viem signTypedData returns a Promise.
 *
 * @param {object} accepted - The Arc Native requirement from the 402 accepts array
 * @param {string} privateKey - The payer's private key (hex, with or without 0x prefix)
 * @returns {Promise<{ signature: string, authorization: object, payer: string }>}
 */
async function signTransferWithAuthorization(accepted, privateKey) {
  const pk = normalizePrivateKey(privateKey);
  if (!pk) throw new Error('Invalid private key');

  const account = privateKeyToAccount(pk);
  const payer = getAddress(account.address);
  const asset = getAddress(accepted.asset);
  const payTo = getAddress(accepted.payTo);
  const amount = String(accepted.amount);

  const validAfter = '0';
  const validBefore = String(Math.floor(Date.now() / 1000) + Number(accepted.maxTimeoutSeconds || 300));
  const nonce = randomNonce();

  const domain = {
    name: String(accepted.extra?.name || 'USDC'),
    version: String(accepted.extra?.version || '2'),
    chainId: ARC_CHAIN_ID,
    verifyingContract: asset,
  };

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };

  const message = {
    from: payer,
    to: payTo,
    value: BigInt(amount),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce: isHex(nonce) ? nonce : `0x${nonce.replace('0x', '')}`,
  };

  // signTypedData is async — must await
  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  const authorization = {
    from: payer,
    to: payTo,
    value: amount,
    validAfter,
    validBefore,
    nonce: message.nonce,
  };

  return { signature, authorization, payer, asset, payTo, amount, validAfter, validBefore, nonce: message.nonce };
}

/**
 * Build the full X-PAYMENT payload from a signed authorization.
 *
 * @param {string} signature - EIP-3009 signature hex
 * @param {object} authorization - The authorization fields
 * @param {object} accepted - The accepted requirement (from 402 accepts)
 * @param {string} resource - The full resource URL being paid for
 * @returns {object} The payment payload suitable for base64Json() -> X-PAYMENT header
 */
function buildPaymentPayload(signature, authorization, accepted, resource) {
  return {
    x402Version: 2,
    resource,
    accepted,
    payload: {
      signature,
      authorization,
    },
  };
}

module.exports = {
  normalizePrivateKey,
  base64Json,
  decodePaymentResponse,
  randomNonce,
  pickNativeRequirement,
  signTransferWithAuthorization,
  buildPaymentPayload,
  ARC_CHAIN_ID,
};
