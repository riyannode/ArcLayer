import { createPublicClient, http, getContract, parseAbi } from 'viem';
const client = createPublicClient({ 
  chain: { id: 5042002, name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } },
  transport: http()
});
const abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function ownerOf(uint256) view returns (address)', 'function totalSupply() view returns (uint256)']);
const reg = getContract({ address: '0x8004A818BFB912233c491871b3d84c89A494BD9e', abi, client });
const wallet = '0xbcbf06e5e79d5dd61a6a606ad2d4d2bd034e8af2';
const bal = await reg.read.balanceOf([wallet]);
console.log('balanceOf:', bal.toString());
try { const s = await reg.read.totalSupply(); console.log('totalSupply:', s.toString()); } catch(e) { console.log('totalSupply REVERTED'); }
// Try sequential ownerOf
for (let i = 1n; i <= 20n; i++) {
  try { const o = await reg.read.ownerOf([i]); console.log('ownerOf(' + i + '):', o.slice(0,10) + '...' + o.slice(-4), o.toLowerCase() === wallet.toLowerCase() ? '<< OURS' : ''); } catch { console.log('ownerOf(' + i + '): BURNED/MISSING'); }
}
