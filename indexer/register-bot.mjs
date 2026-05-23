import { createWalletClient, http, parseAbiItem, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'Arc', symbol: 'ARC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.drpc.testnet.arc.network'] },
    public: { http: ['https://rpc.drpc.testnet.arc.network'] },
  },
});

const privateKey = process.env.PRIVATE_KEY;
const metadataUri = process.env.METADATA_URI;
const registryAddress = '0x8004A818BFB912233c491871b3d84c89A494BD9e';

if (!privateKey || !metadataUri) {
  console.error('Missing PRIVATE_KEY or METADATA_URI');
  process.exit(1);
}

const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
const client = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http(process.env.ARC_RPC_URL)
}).extend(publicActions);

async function register() {
  console.log(`Registering metadata: ${metadataUri}`);
  console.log(`Controller: ${account.address}`);

  const hash = await client.writeContract({
    address: registryAddress,
    abi: [parseAbiItem('function register(string metadataURI)')],
    functionName: 'register',
    args: [metadataUri],
  });

  console.log(`Transaction hash: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`Status: ${receipt.status}`);
  console.log(`Block Number: ${receipt.blockNumber}`);
}

register().catch(err => {
  console.error(err);
  process.exit(1);
});
