import type { RawOracleSignal } from './types.js';

export interface OracleClientOptions {
  oracleBaseUrl: string;
  internalKey?: string;
  timeoutMs?: number;
}

/**
 * Calls the private Pythia Oracle raw-signal endpoint.
 * Payment must NOT happen here. Payment belongs to Resolver's public endpoint.
 */
export async function fetchRawOracleSignals(token: string, body: Record<string, unknown>, opts: OracleClientOptions): Promise<RawOracleSignal[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5_000);
  try {
    const res = await fetch(`${opts.oracleBaseUrl.replace(/\/$/, '')}/internal/oracle/${token}/raw`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.internalKey ? { 'x-internal-key': opts.internalKey } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`oracle_raw_failed_${res.status}: ${await res.text()}`);
    const json = await res.json() as { signals?: RawOracleSignal[] };
    return json.signals ?? [];
  } finally {
    clearTimeout(timeout);
  }
}
