/**
 * Transaction signer for ERC-8183 bot operations.
 *
 * Uses viem to sign + broadcast txs on Arc Testnet.
 * Interprets tx instructions from /api/erc8183-jobs routes
 * and maps to contract ABIs.
 */
const { createWalletClient, createPublicClient, http, keccak256, stringToHex, toBytes } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

// ── Arc Testnet chain config ──────────────────────────────────────────────
const ARC_CHAIN = {
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [] }, public: { http: [] } },
};

// ── Contract addresses (Arc official testnet) ─────────────────────────────
const CONTRACTS = {
  AGENTIC_COMMERCE: '0x0747EEf0706327138c69792bF28Cd525089e4583',
  USDC: '0x3600000000000000000000000000000000000000',
};

// ── ABIs (minimal — only the functions we sign) ───────────────────────────
const USDC_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
];

const AGENTIC_COMMERCE_ABI = [
  {
    name: 'createJob',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'evaluator', type: 'address' },
      { name: 'expiredAt', type: 'uint256' },
      { name: 'description', type: 'string' },
      { name: 'hook', type: 'address' },
    ],
    outputs: [{ name: 'jobId', type: 'uint256' }],
  },
  {
    name: 'setBudget',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'fund',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'submit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'deliverable', type: 'bytes32' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'complete',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'reason', type: 'bytes32' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
];

/**
 * Map function name to contract ABI.
 */
function getAbi(functionName) {
  if (functionName === 'approve') return { address: CONTRACTS.USDC, abi: USDC_ABI };
  // AgenticCommerce functions
  const commerceNames = ['createJob', 'setBudget', 'fund', 'submit', 'complete'];
  if (commerceNames.includes(functionName)) {
    return { address: CONTRACTS.AGENTIC_COMMERCE, abi: AGENTIC_COMMERCE_ABI };
  }
  // Fallback — use backend-provided address, assume caller provides ABI
  return null;
}

/**
 * Create a signer instance from private key + RPC URL.
 */
function createSigner({ privateKey, rpcUrl }) {
  const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(pk);

  ARC_CHAIN.rpcUrls.default.http = [rpcUrl];
  ARC_CHAIN.rpcUrls.public.http = [rpcUrl];

  const walletClient = createWalletClient({
    account,
    chain: ARC_CHAIN,
    transport: http(rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: ARC_CHAIN,
    transport: http(rpcUrl),
  });

  return {
    account,

    address: account.address,

    /**
     * Sign + broadcast a single tx from a backend tx instruction.
     *
     * @param {object} tx - { address, functionName, args }
     * @returns {Promise<{ hash: string, receipt: object }>}
     */
    async sendTx(tx) {
      const abiMap = getAbi(tx.functionName);
      const contractAddress = abiMap ? abiMap.address : tx.address;
      const abi = abiMap ? abiMap.abi : tx.abi;

      if (!abi) {
        throw new Error(`No ABI for function ${tx.functionName}. Provide tx.abi in instruction.`);
      }

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi,
        functionName: tx.functionName,
        args: tx.args,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    },

    /**
     * Sign + broadcast multiple txs sequentially (e.g. approve then fund).
     */
    async sendTxSequence(txs) {
      const results = [];
      for (const tx of txs) {
        const result = await this.sendTx(tx);
        results.push(result);
      }
      return results;
    },

    /**
     * Get USDC balance for this signer's address.
     */
    async getUsdcBalance() {
      return publicClient.readContract({
        address: CONTRACTS.USDC,
        abi: [
          {
            name: 'balanceOf',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
          },
        ],
        functionName: 'balanceOf',
        args: [account.address],
      });
    },

    /**
     * Hash string payload to bytes32 (keccak256) for submit/complete.
     */
    hashPayload(payload) {
      const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return keccak256(toBytes(json));
    },
  };
}

module.exports = { createSigner, CONTRACTS, AGENTIC_COMMERCE_ABI, USDC_ABI };
