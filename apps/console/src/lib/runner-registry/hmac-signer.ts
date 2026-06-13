/**
 * HMAC signer for Console → Runner dispatch.
 *
 * Mirrors the runner-core auth.ts verification:
 *   payload = METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_HASH
 *   signature = "sha256=" + HMAC-SHA256(secret, payload)
 *
 * Headers sent:
 *   x-arclayer-runner-timestamp
 *   x-arclayer-runner-nonce
 *   x-arclayer-runner-signature
 */
import { createHmac, createHash, randomUUID } from 'node:crypto';

export const HMAC_TIMESTAMP_HEADER = 'x-arclayer-runner-timestamp';
export const HMAC_NONCE_HEADER = 'x-arclayer-runner-nonce';
export const HMAC_SIGNATURE_HEADER = 'x-arclayer-runner-signature';

/**
 * Build the HMAC signature payload string.
 * METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_HASH
 * Matches runner-core buildHmacPayload exactly.
 */
export function buildHmacPayload(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyHash: string,
): string {
  return `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

/**
 * Compute SHA-256 hex digest of a string or buffer.
 */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute HMAC-SHA256 hex digest.
 */
export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Sign a dispatch request. Returns the three HMAC headers to attach.
 */
export function signDispatchRequest(input: {
  secret: string;
  method: string;
  path: string;
  body: string | Buffer;
}): {
  [HMAC_TIMESTAMP_HEADER]: string;
  [HMAC_NONCE_HEADER]: string;
  [HMAC_SIGNATURE_HEADER]: string;
} {
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const bodyHash = sha256Hex(typeof input.body === 'string' ? Buffer.from(input.body) : input.body);
  const payload = buildHmacPayload(input.method.toUpperCase(), input.path, timestamp, nonce, bodyHash);
  const signature = `sha256=${hmacSha256Hex(input.secret, payload)}`;

  return {
    [HMAC_TIMESTAMP_HEADER]: timestamp,
    [HMAC_NONCE_HEADER]: nonce,
    [HMAC_SIGNATURE_HEADER]: signature,
  };
}
