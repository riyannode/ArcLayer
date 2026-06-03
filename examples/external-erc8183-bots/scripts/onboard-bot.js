/**
 * Bot onboarding — register ERC-8004 agent via canonical HTTPS metadata draft.
 *
 * Flow (same as frontend):
 *   1. POST /api/a2a/metadata/draft → get draftId, writeToken, metadataURI (HTTPS)
 *   2. Mint ERC-8004 with HTTPS metadataURI
 *   3. PATCH /api/a2a/metadata/draft/<draftId> with agentId + txHash
 *   4. Sync to Supabase
 *   5. Create API key
 *
 * Usage:
 *   node scripts/onboard-bot.js --pk <private-key> --name "My Bot" --preset client
 *   node scripts/onboard-bot.js --pk <private-key> --name "My Bot" --preset provider
 *   node scripts/onboard-bot.js --pk <private-key> --name "My Bot" --preset evaluator
 */
const { privateKeyToAccount } = require('viem/accounts');
const { createPublicClient, createWalletClient, http, decodeEventLog } = require('viem');

const BASE_URL = process.env.ARCLAYER_BASE_URL || 'https://arclayers.xyz';
const RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';

const ERC8004_ABI = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'metadataURI', type: 'string' }], outputs: [] },
  { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'tokenId', type: 'uint256', indexed: true }] },
];

const PRESET_CAPABILITIES = {
  client: ['job-creation', 'escrow', 'fund_job', 'a2a_job'],
  provider: ['claim_job', 'submit_work', 'submit_result', 'escrow', 'a2a_job'],
  evaluator: ['approve_result', 'settle_job', 'escrow', 'a2a_job'],
};

const PRESET_ROLES = {
  client: 'autonomous-client',
  worker: 'provider',  // deprecated alias
  evaluator: 'evaluator',
};

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    result[args[i].replace('--', '')] = args[i + 1];
  }
  return result;
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function createMetadataDraft(controller, metadata) {
  log('draft: creating metadata draft...');
  const res = await fetch(`${BASE_URL}/api/a2a/metadata/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ controller, metadata }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(`draft failed: ${data.error || JSON.stringify(data)}`);
  }
  log(`draft: draftId=${data.draftId} metadataURI=${data.metadataURI?.slice(0, 60)}...`);
  return data;
}

async function patchDraft(draftId, writeToken, agentId, txHash, metadata) {
  log('draft: patching with agentId + txHash...');
  const res = await fetch(`${BASE_URL}/api/a2a/metadata/draft/${draftId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writeToken, agentId, txHash, metadata }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(`draft patch failed: ${data.error || JSON.stringify(data)}`);
  }
  log('draft: patched successfully');
  return data;
}

async function registerOnChain(walletClient, publicClient, metadataURI) {
  log('register: sending tx...');
  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY, abi: ERC8004_ABI, functionName: 'register', args: [metadataURI],
  });
  log(`register: tx=${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log(`register: status=${receipt.status}`);

  let tokenId = null;
  for (const logEntry of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: ERC8004_ABI, data: logEntry.data, topics: logEntry.topics });
      if (decoded.eventName === 'Transfer' && decoded.args.to?.toLowerCase() === walletClient.account.address.toLowerCase()) {
        tokenId = decoded.args.tokenId?.toString();
      }
    } catch {}
  }
  return { hash, tokenId, status: receipt.status };
}

async function syncToSupabase(txHash, controller) {
  log('sync: calling /api/erc8004/identity/sync...');
  const res = await fetch(`${BASE_URL}/api/erc8004/identity/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHash, expectedController: controller }),
  });
  const data = await res.json();
  log(`sync: status=${res.status} ok=${data.ok} tokenId=${data.tokenId || '?'}`);
  return data;
}

async function walletSession(account) {
  log('session: getting nonce...');
  const nonceRes = await fetch(`${BASE_URL}/api/auth/wallet/nonce?address=${account.address}`);
  const { nonce, message } = await nonceRes.json();

  log('session: signing...');
  const signature = await account.signMessage({ message });

  const verifyRes = await fetch(`${BASE_URL}/api/auth/wallet/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: account.address, signature, nonce }),
  });
  const data = await verifyRes.json();
  if (!data.ok) throw new Error('verify failed: ' + JSON.stringify(data));
  const cookie = verifyRes.headers.get('set-cookie')?.split(';')[0] || '';
  log('session: ok');
  return cookie;
}

async function createApiKey(cookie, agentId, label, preset) {
  log(`api-key: creating for agent ${agentId} preset=${preset}...`);
  const res = await fetch(`${BASE_URL}/api/agents/${agentId}/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ label, preset }),
  });
  const data = await res.json();
  log(`api-key: status=${res.status} ok=${data.ok}`);
  return data;
}

async function run() {
  const { pk, name, preset } = parseArgs();
  if (!pk || !name || !preset) {
    console.error('Usage: node scripts/onboard-bot.js --pk <private-key> --name "Bot Name" --preset client|provider|evaluator');
    process.exit(1);
  }

  const normPk = pk.startsWith('0x') ? pk : `0x${pk}`;
  const account = privateKeyToAccount(normPk);
  const publicClient = createPublicClient({ transport: http(RPC) });
  const walletClient = createWalletClient({ account, transport: http(RPC) });

  log(`wallet: ${account.address}`);

  // Build canonical metadata (same shape as frontend)
  const metadata = {
    schema: 'arclayer.agent/v1',
    name,
    role: PRESET_ROLES[preset] || preset,
    description: `Automated ${preset} bot for ERC-8183 agentic commerce`,
    categories: ['arclayer', 'agentic-commerce', 'erc8183-commerce'],
    tags: ['arclayer', 'pm2-bot', preset, 'erc8183'],
    capabilities: PRESET_CAPABILITIES[preset] || ['a2a_job'],
    standard: 'erc8183',
    autonomous: true,
  };

  // Step 1: Create metadata draft (HTTPS URI)
  const draft = await createMetadataDraft(account.address, metadata);

  // Step 2: Mint ERC-8004 with HTTPS metadataURI
  const reg = await registerOnChain(walletClient, publicClient, draft.metadataURI);
  log(`register: tokenId=${reg.tokenId} tx=${reg.hash}`);

  // Step 3: Sync to Supabase
  const syncResult = await syncToSupabase(reg.hash, account.address);
  const agentId = syncResult.tokenId || reg.tokenId;
  log(`agent: id=${agentId}`);

  // Step 4: Patch draft with minted agentId + txHash
  const finalMetadata = { ...metadata, agentId, updatedAt: new Date().toISOString() };
  await patchDraft(draft.draftId, draft.writeToken, agentId, reg.hash, finalMetadata);

  // Step 5: Wallet session
  const cookie = await walletSession(account);

  // Step 6: Create API key
  const keyResult = await createApiKey(cookie, agentId, `[onboarded] ${name}`, preset);

  console.log('\n=== ONBOARDING COMPLETE ===');
  console.log(`WALLET=${account.address}`);
  console.log(`AGENT_ID=${agentId}`);
  console.log(`REGISTER_TX=${reg.hash}`);
  console.log(`METADATA_URI=${draft.metadataURI}`);
  console.log(`API_KEY=${keyResult.key || 'NONE'}`);
  console.log(`PRESET=${preset}`);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
