/**
 * ArcLayer Global MCP — Secret redaction utilities.
 *
 * Applied to error messages and returned error details to prevent
 * accidental exposure of sensitive values.
 */

/** Patterns that indicate sensitive values. */
const SENSITIVE_KEY_RE =
  /PRIVATE_KEY|API_KEY|SECRET|TOKEN|BEARER|MNE?EMONIC|PASSWORD|AUTH|CREDENTIAL/i;

/** Match hex strings that look like 32-byte private keys (0x + 64 hex chars). */
const PRIVATE_KEY_HEX_RE = /\b0x[0-9a-fA-F]{64}\b/g;

/** Match Authorization / Bearer header values. */
const AUTH_HEADER_RE = /(Authorization|Bearer)\s+[^\s"']+/gi;

/** Match common secret patterns in strings. */
const SECRET_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: PRIVATE_KEY_HEX_RE, replacement: '0x[REDACTED_PRIVATE_KEY]' },
  { re: AUTH_HEADER_RE, replacement: '$1 [REDACTED]' },
];

/**
 * Redact sensitive patterns from a string.
 * Returns a new string; never mutates the original.
 */
export function redactString(input: string): string {
  let out = input;
  for (const { re, replacement } of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    re.lastIndex = 0;
    out = out.replace(re, replacement);
  }
  return out;
}

/**
 * Redact sensitive values from a plain object.
 * Keys matching SENSITIVE_KEY_RE have their values replaced with '<redacted>'.
 * Nested objects are traversed recursively (max depth 4).
 * Returns a new object; never mutates the original.
 */
export function redactObject<T extends Record<string, unknown>>(
  obj: T,
  maxDepth = 4,
): Record<string, unknown> {
  if (maxDepth <= 0) return obj;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      result[key] = '<redacted>';
    } else if (typeof value === 'string') {
      result[key] = redactString(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>, maxDepth - 1);
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) =>
        typeof v === 'string' ? redactString(v) : v && typeof v === 'object' ? redactObject(v as Record<string, unknown>, maxDepth - 1) : v,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}
