/**
 * Deterministic bytes32 hashing for deliverables.
 */
const { keccak256, toBytes, stringToHex } = require('viem');

/** Hash a string or object to bytes32 */
function hashPayload(payload) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return keccak256(toBytes(json));
}

/** Hash a canonical JSON string (sorted keys) */
function hashCanonical(obj) {
  const canonical = JSON.stringify(obj, Object.keys(obj).sort());
  return keccak256(toBytes(canonical));
}

module.exports = { hashPayload, hashCanonical };
