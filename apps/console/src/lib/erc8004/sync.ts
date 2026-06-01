/**
 * ERC-8004 Identity Sync — verify on-chain mint and upsert to Supabase.
 *
 * Given a register tx hash, reads the receipt, extracts the minted tokenId,
 * verifies controller/owner, and upserts into erc8004_agents table.
 * This removes dependence on indexer delay after mint.
 */

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { ARC_RPC_URLS, CONTRACTS, ERC8004_IDENTITY_REGISTRY_ABI } from '@arclayer/sdk';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { extractERC8004MintedTokenIdFromReceipt, getERC8004OwnerOf } from '@/lib/contracts/erc8004';

const TABLE = 'erc8004_agents';

export interface SyncErc8004IdentityInput {
  txHash: string;
  expectedController: string;
  metadataURI?: string;
  draftId?: string;
  writeToken?: string;
}

export interface SyncErc8004IdentityResult {
  ok: true;
  tokenId: string;
  agentId: string;
  owner: string;
  controller: string;
  metadataURI: string;
  txHash: string;
  blockNumber: string;
  registryAddress: string;
  chainId: string;
}

/**
 * Read tx receipt, extract minted tokenId, upsert to erc8004_agents.
 */
export async function syncErc8004Identity(
  input: SyncErc8004IdentityInput,
): Promise<SyncErc8004IdentityResult> {
  const controller = input.expectedController.toLowerCase();

  // 1. Read tx receipt
  const client = createPublicClient({
    transport: http(ARC_RPC_URLS[0]),
  });

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({
      hash: input.txHash as Hex,
    });
  } catch {
    throw new Error('tx_not_found_or_not_mined');
  }

  if (receipt.status !== 'success') {
    throw new Error('tx_reverted');
  }

  // 2. Extract tokenId from Transfer(from=0x0, to=controller, tokenId)
  const tokenId = extractERC8004MintedTokenIdFromReceipt(
    { logs: receipt.logs },
    controller as Address,
  );

  const tokenIdStr = tokenId.toString();

  // 3. Verify owner on-chain (optional — may fail on some chains)
  let owner = controller;
  try {
    const onchainOwner = await getERC8004OwnerOf(tokenId);
    owner = onchainOwner.toLowerCase();
  } catch {
    // ownerOf may not be available; use controller as fallback
  }

  // 4. Always read canonical metadataURI from chain
  let metadataURI: string;
  try {
    metadataURI = (await client.readContract({
      address: CONTRACTS.ERC8004_IDENTITY_REGISTRY as Address,
      abi: ERC8004_IDENTITY_REGISTRY_ABI,
      functionName: 'tokenURI',
      args: [tokenId],
    })) as string;
  } catch {
    throw new Error('token_uri_read_failed');
  }

  // Optional caller-provided metadataURI is only an assertion, not source of truth
  if (input.metadataURI && input.metadataURI.trim() !== metadataURI.trim()) {
    throw new Error('metadata_uri_mismatch');
  }

  // 5. Upsert to erc8004_agents
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      {
        token_id: tokenIdStr,
        agent_id: tokenIdStr,
        owner,
        controller,
        metadata_uri: metadataURI,
        source: 'erc8004_identity_registry',
        chain_id: '5042002',
        registry_address: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
        tx_hash: input.txHash,
        block_number: receipt.blockNumber.toString(),
        minted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token_id' },
    );

  if (error) {
    throw new Error(`upsert_failed: ${error.message}`);
  }

  // 6. Patch metadata draft if draftId/writeToken provided
  if (input.draftId && input.writeToken) {
    try {
      const { getMetadataDraft, updateMetadataDraft } = await import('@/lib/a2a/metadata-drafts/store');
      const existing = await getMetadataDraft(input.draftId);
      if (existing) {
        await updateMetadataDraft({
          draftId: input.draftId,
          writeToken: input.writeToken,
          metadata: existing.metadata, // preserve existing metadata
          agentId: tokenIdStr,
          txHash: input.txHash,
        });
      }
      // If draft not found, skip silently — non-fatal
    } catch {
      // Non-fatal — draft patch is optional
    }
  }

  return {
    ok: true,
    tokenId: tokenIdStr,
    agentId: tokenIdStr,
    owner,
    controller,
    metadataURI,
    txHash: input.txHash,
    blockNumber: receipt.blockNumber.toString(),
    registryAddress: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
    chainId: '5042002',
  };
}
