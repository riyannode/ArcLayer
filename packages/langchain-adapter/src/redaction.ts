/**
 * @arclayer/langchain-adapter — Secret redaction utilities.
 *
 * Ensures runnerSecret, signatures, and auth headers never leak
 * into model context, logs, errors, or tool descriptions.
 */

const SENSITIVE_KEYS = [
  "runnerSecret",
  "runner_secret",
  "secret",
  "authorization",
  "x-arclayer-runner-signature",
  "signature",
  "privateKey",
  "private_key",
  "seedPhrase",
  "seed_phrase",
  "circleOtp",
  "circle_otp",
];

/**
 * Redact sensitive fields from an object (shallow).
 * Returns a new object with sensitive values replaced by "***REDACTED***".
 */
export function redactSensitive<T extends Record<string, unknown>>(
  obj: T,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (
      SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()))
    ) {
      result[key] = "***REDACTED***";
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Sanitize an error message — strip any accidental secret leakage.
 * This is a safety net; callers should not pass secrets in messages.
 */
export function sanitizeErrorMessage(msg: string): string {
  let sanitized = msg;
  // Strip anything that looks like a Bearer token
  sanitized = sanitized.replace(
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    "Bearer ***",
  );
  // Strip sha256= signatures
  sanitized = sanitized.replace(
    /sha256=[a-f0-9]{64}/gi,
    "sha256=***",
  );
  // Strip long hex strings (potential keys/hashes)
  sanitized = sanitized.replace(
    /\b[a-f0-9]{64,}\b/gi,
    "***",
  );
  return sanitized;
}
