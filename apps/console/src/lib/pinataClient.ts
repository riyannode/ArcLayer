/**
 * Pinata IPFS client — pins JSON deliverables and returns the CID + URI.
 *
 * We only use the JWT auth path (scoped key). Two endpoints are exposed:
 *   - pinJSON({ name, content }) → { cid, uri, size, pinnedAt }
 *   - testAuth() → boolean (used in startup health check / /api/health)
 *
 * Reliability: retries up to 2 times on 5xx / network error with linear
 * backoff. 4xx returns immediately (auth/payload bug, retry won't fix).
 */

const PINATA_BASE = 'https://api.pinata.cloud';
const PIN_JSON_URL = `${PINATA_BASE}/pinning/pinJSONToIPFS`;
const AUTH_URL = `${PINATA_BASE}/data/testAuthentication`;

export type PinResult = {
  cid: string;          // QmXXXX… (CIDv0) or bafy… (CIDv1)
  uri: string;          // ipfs://<cid> — what we put on chain
  size: number;         // bytes
  pinnedAt: string;     // ISO timestamp from Pinata
};

function getJwt(): string {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    throw new Error('pinata_jwt_missing: env PINATA_JWT not set.');
  }
  return jwt;
}

async function pinataFetch(
  url: string,
  init: RequestInit & { retryable?: boolean } = {},
): Promise<Response> {
  const { retryable = true, ...rest } = init;
  let lastErr: unknown = null;
  const maxAttempts = retryable ? 3 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...rest,
        headers: {
          ...(rest.headers as Record<string, string> | undefined),
          authorization: `Bearer ${getJwt()}`,
        },
      });
      // 4xx = client error → don't retry
      if (res.status >= 400 && res.status < 500) return res;
      // 5xx → retry
      if (res.status >= 500 && attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      throw err;
    }
  }
  // unreachable, but typescript wants it
  throw lastErr ?? new Error('pinata_fetch_unknown');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Pin a JSON object to IPFS. The pinned object is the canonical form of
 * the deliverable (we keccak256 over the same JSON.stringify(content)
 * downstream so the on-chain hash is reproducible from the CID).
 */
export async function pinJSON(args: {
  name: string;
  content: unknown;
  keyvalues?: Record<string, string>;
}): Promise<PinResult> {
  const body = JSON.stringify({
    pinataMetadata: {
      name: args.name,
      ...(args.keyvalues ? { keyvalues: args.keyvalues } : {}),
    },
    pinataContent: args.content,
  });

  const res = await pinataFetch(PIN_JSON_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `pinata_pin_failed: HTTP ${res.status} ${res.statusText} — ${text.slice(0, 300)}`,
    );
  }

  let data: { IpfsHash?: string; PinSize?: number; Timestamp?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`pinata_response_invalid: not JSON — ${text.slice(0, 200)}`);
  }

  if (!data.IpfsHash) {
    throw new Error(`pinata_no_cid: response missing IpfsHash — ${text.slice(0, 200)}`);
  }

  return {
    cid: data.IpfsHash,
    uri: `ipfs://${data.IpfsHash}`,
    size: data.PinSize ?? 0,
    pinnedAt: data.Timestamp ?? new Date().toISOString(),
  };
}

/** Health-check the Pinata JWT. Returns true on 200, throws on bad credentials. */
export async function testAuth(): Promise<boolean> {
  const res = await pinataFetch(AUTH_URL, { method: 'GET', retryable: false });
  if (res.ok) return true;
  const text = await res.text();
  throw new Error(`pinata_auth_failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
}
