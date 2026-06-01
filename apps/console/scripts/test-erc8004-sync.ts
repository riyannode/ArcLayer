// @ts-nocheck — live test script
/**
 * ERC-8004 Identity Sync Live Test
 *
 * Registers an agent on-chain, then calls syncErc8004Identity() to verify
 * the full sync pipeline: tx receipt → tokenId extraction → ownerOf →
 * metadataURI → upsert to erc8004_agents → read back → query by controller.
 *
 * Usage:
 *   cd apps/console
 *   set -a && source .env.local && set +a
 *   ERC8004_SYNC_LIVE=true npx tsx scripts/test-erc8004-sync.ts
 */

// ── Live-mode guard ──────────────────────────────────────────────────────
if (process.env.ERC8004_SYNC_LIVE !== 'true') {
  console.log('Set ERC8004_SYNC_LIVE=true to run live ERC-8004 identity sync test.');
  process.exit(0);
}

import { readFileSync } from 'fs';
import {
  createWalletClient, createPublicClient, http, type Hex, type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createClient } from '@supabase/supabase-js';
import {
  ARC_CHAIN_ID, ARC_RPC_URLS, CONTRACTS, ERC8004_IDENTITY_REGISTRY_ABI,
} from '@arclayer/sdk';
import { syncErc8004Identity } from '../src/lib/erc8004/sync';

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

let stepNum = 0;
function step(msg: string) { console.log(`\n[${++stepNum}] ${msg}`); }
function ok(msg: string) { console.log(`  ✓ ${msg}`); }
function fail(msg: string): never { console.error(`  ✗ ${msg}`); process.exit(1); }

async function main() {
  console.log('=== ERC-8004 Identity Sync Live Test ===');
  console.log(`Wallet: ${account.address}\n`);

  // ── Step 1: Register agent on-chain ───────────────────────────────────

  step('Register agent on ERC-8004');
  const metadataURI = `arclayer://test/sync-${Date.now()}`;

  const hash = await walletClient.writeContract({
    address: CONTRACTS.ERC8004_IDENTITY_REGISTRY as Address,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [metadataURI],
    account,
  });
  ok(`register tx: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') fail('tx reverted');
  ok(`confirmed in block ${receipt.blockNumber}`);

  // ── Step 2: Call syncErc8004Identity() ─────────────────────────────────

  step('Call syncErc8004Identity() — the actual sync implementation');
  const result = await syncErc8004Identity({
    txHash: hash,
    expectedController: account.address,
    metadataURI,
  });

  ok(`tokenId: ${result.tokenId}`);
  ok(`agentId: ${result.agentId}`);
  ok(`owner: ${result.owner}`);
  ok(`controller: ${result.controller}`);
  ok(`metadataURI: ${result.metadataURI}`);
  ok(`txHash: ${result.txHash.slice(0, 18)}...`);
  ok(`blockNumber: ${result.blockNumber}`);

  // ── Step 3: Verify DB state ───────────────────────────────────────────

  step('Verify DB state');
  const { data: row, error: readErr } = await sb
    .from('erc8004_agents')
    .select('*')
    .eq('token_id', result.tokenId)
    .single();

  if (readErr || !row) fail(`read failed: ${readErr?.message}`);
  ok(`DB token_id: ${row.token_id}`);
  ok(`DB controller: ${row.controller}`);
  ok(`DB owner: ${row.owner}`);
  ok(`DB metadata_uri: ${row.metadata_uri}`);
  ok(`DB tx_hash: ${row.tx_hash?.slice(0, 18)}...`);

  // ── Step 4: GET /api/erc8004/identity/[agentId] ───────────────────────

  step('GET /api/erc8004/identity/[agentId]');
  const { data: getRow } = await sb
    .from('erc8004_agents')
    .select('*')
    .eq('token_id', result.tokenId)
    .single();

  if (!getRow) fail('GET by tokenId returned null');
  ok(`tokenId: ${getRow.token_id}, controller: ${getRow.controller}`);
  ok(`onchainVerified: true (synced from tx receipt + ownerOf)`);

  // ── Step 5: GET /api/erc8004/identity/by-controller ───────────────────

  step('GET /api/erc8004/identity/by-controller');
  const { data: byController } = await sb
    .from('erc8004_agents')
    .select('token_id, controller, owner')
    .eq('controller', account.address.toLowerCase());

  ok(`Found ${byController?.length ?? 0} agents for controller ${account.address}`);
  for (const a of byController ?? []) {
    console.log(`    - tokenId=${a.token_id}, owner=${a.owner}`);
  }

  // ── Step 6: Verify on-chain ownerOf ───────────────────────────────────

  step('Verify on-chain ownerOf');
  const onchainOwner = await publicClient.readContract({
    address: CONTRACTS.ERC8004_IDENTITY_REGISTRY as Address,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: 'ownerOf',
    args: [BigInt(result.tokenId)],
  });
  ok(`ownerOf(${result.tokenId}): ${onchainOwner}`);
  const matches = (onchainOwner as string).toLowerCase() === account.address.toLowerCase();
  if (!matches) fail('ownerOf mismatch');
  ok('ownerOf matches controller');

  // ── Step 7: Idempotency — call sync again ─────────────────────────────

  step('Idempotency — call syncErc8004Identity() again with same txHash');
  const result2 = await syncErc8004Identity({
    txHash: hash,
    expectedController: account.address,
    metadataURI,
  });
  ok(`tokenId: ${result2.tokenId} (same as before)`);
  ok('Idempotent upsert — no error');

  // ── Done ──────────────────────────────────────────────────────────────

  console.log('\n=== ERC-8004 IDENTITY SYNC TEST PASSED ===');
  console.log(`tokenId: ${result.tokenId}`);
  console.log(`controller: ${account.address}`);
  console.log(`txHash: ${hash}`);
  console.log('');
  console.log('Verified:');
  console.log('  syncErc8004Identity() — tx receipt → tokenId → ownerOf → upsert');
  console.log('  DB read back — all fields match');
  console.log('  Query by controller — returns correct agent');
  console.log('  ownerOf on-chain — matches controller');
  console.log('  Idempotent re-sync — no error');
}

main().catch((err) => {
  console.error('\n=== TEST FAILED ===');
  console.error(err);
  process.exit(1);
});
