/**
 * Config — safe env loading with validation.
 * Never logs secret values.
 */
require('dotenv').config({ path: __dirname + '/../.env' });

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

function int(name, fallback) {
  const raw = process.env[name]?.trim();
  return raw ? parseInt(raw, 10) : fallback;
}

function bool(name, fallback = false) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1';
}

/** Redact a value for logging — shows first 6 chars only */
function redact(value) {
  if (!value || typeof value !== 'string') return '<empty>';
  if (value.length <= 8) return '***';
  return value.slice(0, 6) + '***';
}

module.exports = {
  required,
  optional,
  requiredAddress,
  normalizePrivateKey,
  int,
  bool,
  redact,
};
