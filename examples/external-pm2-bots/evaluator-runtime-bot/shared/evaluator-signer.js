/**
 * Evaluator Signer — Transaction signing for evaluator wallet.
 *
 * Supported modes:
 *   - legacy-eoa: reads EVALUATOR_PRIVATE_KEY, derives address, sends raw tx.
 *   - circle-dcw-sca: not_configured (future)
 *   - agent-wallet-delegated: not_configured (future)
 *
 * Security:
 * - Validates derived address matches EVALUATOR_ADDRESS at startup.
 * - Fatal exit on mismatch.
 * - Never logs private key.
 * - Policy guard: only allows complete() and reject() on the ERC-8183 contract.
 */

// complete(uint256 jobId, bytes32 reasonHash, bytes optParams) selector
const COMPLETE_SELECTOR = '0xd75bbdf3';
// reject(uint256 jobId, bytes32 reasonHash, bytes optParams) selector
const REJECT_SELECTOR = '0x41dd26f5';

class EvaluatorSigner {
  constructor(config) {
    this.mode = config.signerMode || 'legacy-eoa';
    this.evaluatorAddress = config.evaluatorAddress;
    this.privateKey = config.privateKey;
    this.chainId = config.chainId || 5042002; // Arc Testnet
    this.contractAddress = config.contractAddress; // ERC-8183 AgenticCommerce
    this.rpcUrl = config.rpcUrl || 'https://arc-testnet.drpc.org';

    // Validate mode
    if (this.mode !== 'legacy-eoa') {
      console.error(`[SIGNER] Mode "${this.mode}" is not configured. Only legacy-eoa is supported.`);
      return;
    }

    // Validate key matches address
    if (!this.privateKey) {
      console.error('[FATAL] EVALUATOR_PRIVATE_KEY not set');
      process.exit(1);
    }
    if (!this.evaluatorAddress) {
      console.error('[FATAL] EVALUATOR_ADDRESS not set');
      process.exit(1);
    }
  }

  /**
   * Verify key-address match at startup. Call once during init.
   */
  async verify() {
    if (this.mode !== 'legacy-eoa') {
      throw new Error(`Signer mode "${this.mode}" is not configured. Use legacy-eoa.`);
    }

    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(this.privateKey);
    if (account.address.toLowerCase() !== this.evaluatorAddress.toLowerCase()) {
      console.error(
        `[FATAL] EVALUATOR_PRIVATE_KEY derived address (${account.address}) does not match EVALUATOR_ADDRESS (${this.evaluatorAddress})`
      );
      process.exit(1);
    }
    console.log(`[SIGNER] Verified evaluator address: ${account.address}`);
    return account.address;
  }

  /**
   * Policy guard: validate transaction instruction before signing.
   * Only allows complete() and reject() on the ERC-8183 contract.
   * Validates chainId is Arc Testnet (5042002).
   */
  validateTxPolicy(txInstruction) {
    const to = (txInstruction.to || '').toLowerCase();
    const data = txInstruction.data || '0x';

    // Must target the ERC-8183 contract
    if (to !== this.contractAddress.toLowerCase()) {
      throw new Error(
        `[POLICY] Rejected: tx targets ${txInstruction.to}, expected ${this.contractAddress}`
      );
    }

    // Must be a known selector (complete or reject only)
    const selector = data.slice(0, 10).toLowerCase();
    if (selector !== COMPLETE_SELECTOR && selector !== REJECT_SELECTOR) {
      throw new Error(
        `[POLICY] Rejected: unknown selector ${selector}. Only complete() and reject() are allowed.`
      );
    }

    // Chain must be Arc Testnet
    if (this.chainId !== 5042002) {
      throw new Error(
        `[POLICY] Rejected: chainId ${this.chainId} is not Arc Testnet (5042002)`
      );
    }

    return true;
  }

  /**
   * Sign and send a transaction.
   * @param {Object} txInstruction - { to, data, value } from MCP prepare tool
   * @returns {Object} - { txHash, blockNumber, gasUsed }
   */
  async signAndSend(txInstruction) {
    if (this.mode !== 'legacy-eoa') {
      throw new Error(`Signer mode "${this.mode}" is not configured.`);
    }

    // Policy guard
    this.validateTxPolicy(txInstruction);

    const { createWalletClient, http } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { arcTestnet } = await import('viem/chains');

    const account = privateKeyToAccount(this.privateKey);
    const walletClient = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(this.rpcUrl),
    });

    const to = txInstruction.to;
    const data = txInstruction.data;
    const value = txInstruction.value ? BigInt(txInstruction.value) : 0n;

    const txHash = await walletClient.sendTransaction({ to, data, value });
    console.log(`[SIGNER] Tx sent: ${txHash}`);

    // Wait for receipt
    const { createPublicClient } = await import('viem');
    const publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(this.rpcUrl),
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 60_000,
    });

    return {
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
    };
  }
}

module.exports = { EvaluatorSigner };
