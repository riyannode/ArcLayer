/**
 * Env helper — required/optional with validation.
 */
require('dotenv').config();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function optional(name, fallback = '') {
  return process.env[name]?.trim() || fallback;
}

function requiredAddress(name) {
  const value = required(name);
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${name} must be a valid 0x address`);
  }
  return value;
}

function normalizePrivateKey(value) {
  return value.startsWith('0x') ? value : `0x${value}`;
}

module.exports = { required, optional, requiredAddress, normalizePrivateKey };
