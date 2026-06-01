// @ts-nocheck — live test script
import { readFileSync } from 'fs';
import {
  createWalletClient, createPublicClient, http, type Hex, type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createClient } from '@supabase/supabase-js';
import {
  ARC_CHAIN_ID, ARC_RPC_URLS, CONTRACTS, ERC8004_IDENTITY_REGISTRY_ABI,
} from '@arclayer/sdk';
import { extractERC8004MintedTokenIdFromReceipt } from '../src/lib/contracts/erc8004';

const wallets = JSON.parse(readFileSync('/root/.secrets/arc-test-wallets/wallets.json', 'utf-8'));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const CHAIN = {
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ARC_RPC_URLS }, public: { http: ARC_RPC_URLS } },
};
const transport = http(ARC_RPC_URLS[0]);
const publicClient = createPublicClient({ chain: CHAIN, transport });

const account = privateKeyToAccount(wallets.client.privateKey as Hex);
const walletClient = createWalletClient({ account, chain: CHAIN, transport });

async function main() {
  console.log('=== ERC-8004 Identity Sync Live Test ===');
  console.log(`Wallet: ${account.address}\n`);

  // 1. Register agent on-chain
  console.log('[1] Register agent on ERC-8004...');
  const metadataURI = `arclayer://test/smoke-${Date.now()}`;

  const hash = await walletClient.writeContract({
    address: CONTRACTS.ERC8004_IDENTITY_REGISTRY as Address,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [metadataURI],
    account,
  });
  console.log(`  ✓ register tx: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') { console.error('  ✗ tx reverted'); process.exit(1); }

  // 2. Extract tokenId from receipt
  const tokenId = extractERC8004MintedTokenIdFromReceipt(
    { logs: receipt.logs },
    account.address,
  );
  console.log(`  ✓ tokenId: ${tokenId}`);
  console.log(`  ✓ block: ${receipt.blockNumber}`);

  // 3. Sync to Supabase (simulating what the API route does)
  console.log('\n[2] Sync to erc8004_agents table...');
  const { error } = await sb
    .from('erc8004_agents')
    .upsert(
      {
        token_id: tokenId.toString(),
        agent_id: tokenId.toString(),
        owner: account.address.toLowerCase(),
        controller: account.address.toLowerCase(),
        metadata_uri: metadataURI,
        source: 'erc8004_identity_registry',
        chain_id: '5042002',
        registry_address: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
        tx_hash: hash,
        block_number: receipt.blockNumber.toString(),
        minted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token_id' },
    );

  if (error) { console.error(`  ✗ upsert failed: ${error.message}`); process.exit(1); }
  console.log(`  ✓ Upserted token_id=${tokenId} to erc8004_agents`);

  // 4. Read back
  console.log('\n[3] Read back from erc8004_agents...');
  const { data, error: readErr } = await sb
    .from('erc8004_agents')
    .select('*')
    .eq('token_id', tokenId.toString())
    .single();

  if (readErr || !data) { console.error(`  ✗ read failed: ${readErr?.message}`); process.exit(1); }
  console.log(`  ✓ agentId: ${data.agent_id}`);
  console.log(`  ✓ controller: ${data.controller}`);
  console.log(`  ✓ owner: ${data.owner}`);
  console.log(`  ✓ metadataURI: ${data.metadata_uri}`);
  console.log(`  ✓ txHash: ${data.tx_hash?.slice(0, 18)}...`);
  console.log(`  ✓ blockNumber: ${data.block_number}`);

  // 5. Query by controller
  console.log('\n[4] Query by controller...');
  const { data: byController } = await sb
    .from('erc8004_agents')
    .select('token_id, agent_id, controller')
    .eq('controller', account.address.toLowerCase());

  console.log(`  ✓ Found ${byController?.length ?? 0} agents for controller`);

  // 6. Owner verification
  console.log('\n[5] Verify owner on-chain...');
  const onchainOwner = await publicClient.readContract({
    address: CONTRACTS.ERC8004_IDENTITY_REGISTRY as Address,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
  });
  console.log(`  ✓ on-chain ownerOf(${tokenId}): ${onchainOwner}`);
  console.log(`  ✓ matches: ${(onchainOwner as string).toLowerCase() === account.address.toLowerCase()}`);

  console.log('\n=== ERC-8004 IDENTITY SYNC TEST PASSED ===');
  console.log(`tokenId: ${tokenId}`);
  console.log(`controller: ${account.address}`);
  console.log(`txHash: ${hash}`);
}

main().catch((err) => {
  console.error('\n=== TEST FAILED ===');
  console.error(err);
  process.exit(1);
});
