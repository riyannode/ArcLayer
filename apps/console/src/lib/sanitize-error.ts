/**
 * Sanitize errors before returning them in HTTP responses.
 * Strips stack traces, secrets, and absolute filesystem paths to prevent
 * leaking internal state to API consumers.
 */

const MAX_ERROR_LENGTH = 200;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers
  [/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [redacted]'],
  // Common key prefixes (sk-, ksk_, pk-, api_key=, secret=, token=)
  [/\b(?:sk|ksk|pk)[_-][A-Za-z0-9]{8,}/gi, '[redacted-key]'],
  [/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[^\s'"&]{4,}/gi, '[redacted-credential]'],
  // URLs with embedded userinfo (https://user:pass@host)
  [/(https?:\/\/)[^:\s/]+:[^@\s]+@/gi, '$1[redacted]@'],
  // Absolute filesystem paths
  [/\/(?:home|root|var|etc|opt|usr|tmp|srv)\/[^\s'":,;]+/g, '[path]'],
  [/[A-Z]:\\[^\s'":,;]+/g, '[path]'],
];

export function sanitizeErrorMessage(err: unknown): string {
  let msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'agent execution failed';

  // Drop stack trace — take only the first line.
  msg = msg.split('\n')[0]?.trim() ?? '';

  if (!msg) return 'agent execution failed';

  // Mask secret patterns.
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    msg = msg.replace(pattern, replacement);
  }

  // Truncate to bounded length.
  if (msg.length > MAX_ERROR_LENGTH) {
    msg = msg.slice(0, MAX_ERROR_LENGTH) + '…';
  }

  return msg || 'agent execution failed';
}
