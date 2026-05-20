// Bounded RPC helpers for indexer projections.
//
// Requirement #3: Limit RPC concurrency to 3-5 parallel calls.
// Requirement #4: Add per-call timeout (3-5 seconds).
//
// The viem fallback transport already retries across dRPC → testnet → quicknode →
// blockdaemon, but a hung TCP connection can still keep a Promise pending forever.
// `withTimeout` enforces a hard ceiling so a slow upstream cannot block the
// indexer event loop.

const RPC_CONCURRENCY = Number(process.env.INDEXER_RPC_CONCURRENCY || 4);
const RPC_TIMEOUT_MS = Number(process.env.INDEXER_RPC_TIMEOUT_MS || 4_000);

export class RpcTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`RPC timeout after ${ms}ms: ${label}`);
    this.name = "RpcTimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms: number = RPC_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RpcTimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Run `fn` over `items` with bounded concurrency. Failures (including timeouts)
 * are captured per-item so a single slow RPC cannot stall the whole batch.
 */
export async function mapWithLimit<TIn, TOut>(
  items: readonly TIn[],
  limit: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<Array<TOut | null>> {
  const results: Array<TOut | null> = new Array(items.length).fill(null);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = null;
        // Swallow — caller decides whether to log. Keeps the batch moving.
        if (process.env.INDEXER_DEBUG === "1") {
          console.warn(`[indexer] mapWithLimit item ${i} failed:`, err instanceof Error ? err.message : err);
        }
      }
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

export const INDEXER_RPC = {
  CONCURRENCY: RPC_CONCURRENCY,
  TIMEOUT_MS: RPC_TIMEOUT_MS,
};
