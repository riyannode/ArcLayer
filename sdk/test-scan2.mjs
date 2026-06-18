import { createPublicClient, http, getContract, parseAbi } from 'viem';
const client = createPublicClient({ 
  chain: { id: 5042002, name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } },
  transport: http()
});
const abi = parseAbi(['function ownerOf(uint256) view returns (address)']);
const reg = getContract({ address: '0x8004A818BFB912233c491871b3d84c89A494BD9e', abi, client });
const wallet = '0xbcbf06e5e79d5dd61a6a606ad2d4d2bd034e8af2';
// Binary-ish search: try larger ranges
const ranges = [200, 500, 1000, 2000, 5000];
for (const max of ranges) {
  try {
    const o = await reg.read.ownerOf([BigInt(max)]);
    console.log('ownerOf(' + max + '):', o.slice(0,10));
  } catch {
    console.log('ownerOf(' + max + '): BURNED/MISSING - upper bound found below this');
    break;
  }
}
