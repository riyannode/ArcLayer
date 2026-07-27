import { createPublicClient, http, parseAbiItem } from 'viem';
const client = createPublicClient({ 
  chain: { id: 5042002, name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } },
  transport: http()
});
const wallet = '0xbcbf06e5e79d5dd61a6a606ad2d4d2bd034e8af2';
const registry = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

// Get Transfer events TO our wallet from the registry contract
const logs = await client.getLogs({
  address: registry,
  event: transferEvent,
  args: { to: wallet },
  fromBlock: 0n,
  toBlock: 'latest',
});
console.log('Transfer events to wallet:', logs.length);
for (const log of logs) {
  console.log('tokenId:', log.args.tokenId.toString(), 'from:', log.args.from.slice(0,10), 'block:', log.blockNumber.toString());
}
