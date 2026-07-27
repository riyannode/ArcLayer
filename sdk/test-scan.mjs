import { createPublicClient, http, getContract, parseAbi } from 'viem';
const client = createPublicClient({ 
  chain: { id: 5042002, name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } },
  transport: http()
});
const abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function ownerOf(uint256) view returns (address)']);
const reg = getContract({ address: '0x8004A818BFB912233c491871b3d84c89A494BD9e', abi, client });
const wallet = '0xbcbf06e5e79d5dd61a6a606ad2d4d2bd034e8af2';
const bal = await reg.read.balanceOf([wallet]);
console.log('balanceOf:', bal.toString());
let found = 0;
let consecutiveMisses = 0;
for (let i = 1n; i <= 200n && found < Number(bal); i++) {
  try { 
    const o = await reg.read.ownerOf([i]); 
    if (o.toLowerCase() === wallet.toLowerCase()) {
      console.log('FOUND tokenId:', i.toString(), 'owner:', o.slice(0,10) + '...' + o.slice(-4));
      found++;
    }
    consecutiveMisses = 0;
  } catch { 
    consecutiveMisses++;
  }
}
if (found === 0) console.log('NOT FOUND in 1-200');
