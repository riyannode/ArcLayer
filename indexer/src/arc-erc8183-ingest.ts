/**
 * arc-erc8183-ingest.ts — DEPRECATED secondary indexer shim.
 *
 * In 100% Arc/Circle reference mode, the primary `ingest.ts` already targets
 * the official ERC-8183 AgenticCommerce contract directly. This module is kept
 * as a thin shim for backward-compat with any external callers and is now a
 * pass-through to `fetchJobEvents` from the main pipeline.
 *
 * @deprecated Use `fetchJobEvents` from `./ingest` instead.
 */

import { fetchJobEvents, type FetchJobEventsResult } from "./ingest";

export type ArcErc8183Event = FetchJobEventsResult["events"][number];

export interface FetchArcErc8183Result {
  events: ArcErc8183Event[];
  latestBlock: bigint;
}

/** No-op in reference mode — the primary indexer already covers all ERC-8183 events. */
export function updateKnownAgentAddresses(_addresses: string[]) {
  // Reference mode indexes all ERC-8183 events without filtering. Filter at
  // query time if you need to scope by wallet.
}

/** @deprecated Use `fetchJobEvents` from `./ingest` instead. */
export async function fetchArcErc8183Events(
  fromBlock: bigint = BigInt(0),
): Promise<FetchArcErc8183Result> {
  const { events, latestBlock } = await fetchJobEvents(fromBlock);
  return { events: events as unknown as ArcErc8183Event[], latestBlock };
}
