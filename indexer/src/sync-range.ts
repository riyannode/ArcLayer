export function calculateToBlock(fromBlock: bigint, chainLatestBlock: bigint, maxBlockRange: bigint) {
  const maxToBlock = fromBlock + maxBlockRange - 1n;
  return maxToBlock < chainLatestBlock ? maxToBlock : chainLatestBlock;
}
