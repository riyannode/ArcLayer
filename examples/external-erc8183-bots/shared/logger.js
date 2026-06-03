/**
 * Structured logger — [ISO] [PHASE] key=value
 * Redacts API keys, private keys, bearer tokens.
 */
const REDACT_PATTERNS = [
  /ak_[a-zA-Z0-9_]+/g,                    // API keys
  /0x[a-fA-F0-9]{64}/g,                    // private keys (64 hex = 32 bytes)
  /Bearer\s+[^\s]+/gi,                     // bearer tokens
  /mnemonic[^\s]*/gi,                       // mnemonics
  /PRIVATE_KEY[^\s]*/gi,                    // env references
  /WALLET_SESSION_SECRET[^\s]*/gi,          // session secrets
];

function redactLine(line) {
  let result = line;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, '<redacted>');
  }
  return result;
}

function log(phase, fields) {
  const ts = new Date().toISOString();
  const parts = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const line = `[${ts}] [${phase}] ${parts}`;
  console.log(redactLine(line));
}

function error(phase, fields) {
  const ts = new Date().toISOString();
  const parts = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const line = `[${ts}] [${phase}] ${parts}`;
  console.error(redactLine(line));
}

module.exports = { log, error, redactLine };
