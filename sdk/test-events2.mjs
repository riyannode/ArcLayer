import { createPublicClient, http, parseAbiItem } from 'viem';
const client = createPublicClient({ 
  chain: { id: 5042002, name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } },
  transport: http()
});
const wallet = '0xbcbf06e5e79d5dd61a6a606ad2d4d2bd034e8af2';
const registry = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

const latest = await client.getBlockNumber();
console.log('latest block:', latest.toString());

// Scan backwards in 10K chunks
let found = false;
for (let end = latest; end > 0n && !found; end -= 10000n) {
  const start = end > 10000n ? end - 10000n : 0n;
  try {
    const logs = await client.getLogs({
      address: registry,
      event: transferEvent,
      args: { to: wallet },
      fromBlock: start,
      toBlock: end,
    });
    if (logs.length > 0) {
      for (const log of logs) {
        if (log.args.from === '0x0000000000000000000000000000000000000000') {
          console.log('MINT FOUND! tokenId:', log.args.tokenId.toString(), 'block:', log.blockNumber.toString());
          found = true;
        }
      }
    }
  } catch (e) {
    console.log('chunk error:', start.toString(), '-', end.toString(), e.message.slice(0, 50));
  }
}
if (!found) console.log('No mint Transfer found');
