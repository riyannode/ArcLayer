/**
 * Register manifests + generate API keys for the 4 prediction market bots.
 *
 * Each bot wallet owns its own ERC-8004 token, so we process one at a time.
 * 
 * Usage: node scripts/register-bots.mjs
 */

import { createPublicClient, http, getAddress, keccak256, stringToBytes, hexToBytes, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const BASE = 'https://www.arclayers.xyz';
const RPC = 'https://rpc.testnet.arc.network';
const USDC = getAddress('0x3600000000000000000000000000000000000000');
const ARC_CHAIN_ID = 5042002;

const BOTS = [
  { role: 'oracle',   pk: '0xdbcc3a3bf0803de30e079710a24c9d5438f9a187974f32ad7076cccf574ea1b6', agentId: '24148' },
  { role: 'analyzer', pk: '0x80ff7e30f2e779a5a6e3b786279468863d415579bda1147f70ba71fb07440dff', agentId: '24149' },
  { role: 'evaluator', pk: '0xc9640154cdb65d4faaa68cc8c3fc38dcb28aa8c8403772ee66826cf2afc317fe', agentId: '24150' },
  { role: 'executor', pk: '0x8329003c83819cd9e74838d6e665c0779887769ecb59bc45f85f68951df215fd', agentId: '24151' },
];

const TEMPLATE_ROLES = {
  oracle:   { displayName: 'Hermes Oracle',   capabilities: ['market_snapshot'], endpointPath: 'oracle-bot.js' },
  analyzer: { displayName: 'Apollo Analyzer', capabilities: ['resolver_output'], endpointPath: 'analyzer-bot.js' },
  evaluator:{ displayName: 'Ignia Evaluator', capabilities: ['evaluation'], endpointPath: 'evaluator-bot.js' },
  executor: { displayName: 'Budu Executor',   capabilities: ['execution_intent'], endpointPath: 'executor-bot.js' },
};

const client = createPublicClient({ transport: http(RPC) });

function buildManifest(bot, ts) {
  const role = TEMPLATE_ROLES[bot.role];
  return {
    schema: 'arclayer.agent/v1',
    version: 1,
    agentId: bot.agentId,
    name: `Prediction Market PM2 Bridge — ${role.displayName}`,
    role: bot.role,
    description: `${role.displayName}: ${role.capabilities.join(', ')}`,
    categories: ['prediction-market-bots'],
    capability: role.capabilities,
    capabilities: role.capabilities,
    roles: [{
      id: bot.role,
      name: role.displayName,
      category: 'prediction-market-bots',
      capabilities: role.capabilities,
      endpointPath: role.endpointPath,
      enabled: true,
    }],
    x402: { enabled: true, network: 'arc-testnet', currency: 'USDC', price: '1000' },
    jobs: { accepts: ['claim', 'run', 'submit-proof'], inputFormats: ['text', 'json'], outputFormats: ['markdown', 'json', 'proof'] },
    proof: { types: ['signed_result', 'workproof_nft', 'url'], signing: 'eip191' },
    createdAt: new Date(ts * 1000).toISOString(),
    updatedAt: new Date(ts * 1000).toISOString(),
  };
}

function canonicalManifestJson(manifest) {
  function can(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(can).join(',') + ']';
    if (typeof v === 'object') {
      const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + can(v[k])).join(',') + '}';
    }
    return 'null';
  }
  return can(manifest);
}

function computeHash(manifest) {
  return keccak256(stringToBytes(canonicalManifestJson(manifest)));
}

async function signEIP3009(account, amount, payTo, validBefore, nonce) {
  const domain = {
    name: 'USDC',
    version: '2',
    chainId: ARC_CHAIN_ID,
    verifyingContract: USDC,
  };
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };
  const message = {
    from: account.address,
    to: getAddress(payTo),
    value: BigInt(amount),
    validAfter: 0n,
    validBefore: BigInt(validBefore),
    nonce: nonce,
  };
  return account.signTypedData({ domain, types, primaryType: 'TransferWithAuthorization', message });
}

async function x402Post(account, url, body) {
  // Step 1: Request without payment → get 402 + accepts
  const payer = account.address;
  const challengeUrl = `${url}?rail=arc-native-eoa&payer=${payer}`;
  
  console.log(`  → Challenge ${challengeUrl}`);
  const challengeRes = await fetch(challengeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const challengeJson = await challengeRes.json();
  
  if (challengeRes.status !== 402) {
    if (challengeRes.ok) {
      console.log(`  ✅ No payment needed (status ${challengeRes.status})`);
      return challengeJson;
    }
    throw new Error(`Challenge failed: ${challengeRes.status} ${JSON.stringify(challengeJson)}`);
  }

  // Step 2: Find USDC requirement
  const accepts = Array.isArray(challengeJson?.accepts) ? challengeJson.accepts : [];
  const req = accepts.find(a => getAddress(a.asset) === USDC);
  if (!req) throw new Error(`No USDC requirement: ${JSON.stringify(challengeJson)}`);

  const requiredAmount = BigInt(req.amount);
  const payTo = getAddress(req.payTo);
  const validBefore = Math.floor(Date.now() / 1000) + 600;
  const nonce = keccak256(stringToBytes(`${url}|${payer}|${Date.now()}`));

  // Check balance
  const balance = await client.readContract({
    address: USDC,
    abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
    functionName: 'balanceOf',
    args: [payer],
  });
  console.log(`  Balance: ${balance} USDC (need ${requiredAmount})`);
  if (balance < requiredAmount) throw new Error(`Insufficient USDC: have ${balance}, need ${requiredAmount}`);

  // Step 3: Sign EIP-3009
  console.log(`  → Signing EIP-3009: ${requiredAmount} USDC → ${payTo}`);
  const sig = await signEIP3009(account, req.amount, payTo, validBefore, nonce);

  // Step 4: Build payment payload
  const paymentPayload = {
    x402Version: 2,
    accepted: {
      ...req,
      asset: getAddress(req.asset),
      payTo,
      extra: { name: 'USDC', version: '2', decimals: 6, symbol: 'USDC' },
    },
    payload: {
      signature: sig,
      authorization: {
        from: payer,
        to: payTo,
        value: req.amount,
        validAfter: '0',
        validBefore: String(validBefore),
        nonce,
      },
    },
  };

  // Step 5: Retry with X-PAYMENT header
  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
  console.log(`  → Sending with payment`);
  const paidRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PAYMENT': paymentHeader },
    body: JSON.stringify(body),
  });
  const paidJson = await paidRes.json();
  
  if (!paidRes.ok) throw new Error(`Payment POST failed: ${paidRes.status} ${JSON.stringify(paidJson)}`);
  console.log(`  ✅ Paid manifest posted`);
  return paidJson;
}

function maskSecret(secret) {
  if (!secret || typeof secret !== 'string') return '[redacted]';
  if (secret.length <= 10) return `${secret.slice(0, 2)}…${secret.slice(-2)}`;
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

async function registerBot(bot) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🤖 ${bot.role.toUpperCase()} (token ${bot.agentId})`);
  console.log(`${'='.repeat(60)}`);
  
  const account = privateKeyToAccount(bot.pk);
  console.log(`  Address: ${account.address}`);

  const ts = Math.floor(Date.now() / 1000);
  const manifest = buildManifest(bot, ts);
  const hash = computeHash(manifest);
  
  // Sign manifest message (ArcLayer Manifest v1 format)
  const manifestMsg = `ArcLayer Manifest v1\nagentId=${bot.agentId}\nhash=${hash}\nts=${ts}`;
  const signature = await account.signMessage({ message: manifestMsg });
  console.log(`  Manifest hash: ${hash.slice(0, 16)}…`);
  console.log(`  Signed: ${signature.slice(0, 16)}…`);

  // POST manifest with x402
  const body = {
    agentId: bot.agentId,
    manifest,
    signature,
    signer: account.address,
    ts,
  };

  const result = await x402Post(account, `${BASE}/api/a2a/manifest`, body);
  console.log(`  ✅ Manifest published:`, result.ok ? 'ok' : JSON.stringify(result).slice(0, 100));

  // Generate API key
  const keyTs = Math.floor(Date.now() / 1000);
  const keyMsg = `ArcLayer A2A API Key\naction: create\nagentId: ${bot.agentId}\nts: ${keyTs}`;
  const keySig = await account.signMessage({ message: keyMsg });

  const keyRes = await fetch(`${BASE}/api/a2a/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: bot.agentId,
      label: `${TEMPLATE_ROLES[bot.role].displayName} Runtime Key`,
      scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
      ts: keyTs,
      signature: keySig,
    }),
  });
  const keyData = await keyRes.json();
  if (!keyRes.ok || !keyData.ok) throw new Error(`Key gen failed: ${JSON.stringify(keyData)}`);
  
  const apiKey = keyData.apiKey || keyData.key;
  console.log(`  🔑 API Key: ${maskSecret(apiKey)}`);
  
  return { ...bot, address: account.address, apiKey, manifestHash: hash };
}

async function main() {
  const results = [];
  for (const bot of BOTS) {
    const r = await registerBot(bot);
    results.push(r);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\n# ── .env.common ──`);
  console.log(`ARCLAYER_BASE_URL=${BASE}`);
  console.log(`AGENT_CATEGORY=prediction-market-bots`);
  console.log(`MARKET_EXECUTION_MODE=DRY_RUN`);
  console.log(`PROTOCOL_TX_MODE=ARC_TESTNET`);
  console.log(`X402_AUTOPAY=true`);
  console.log(`X402_AUTOPAY_REQUIRED=false`);
  console.log(`X402_SCOPE=external_trace`);
  console.log(`BOT_INTERVAL_MS=900000`);
  console.log(`# X402_PAYER_PRIVATE_KEY=<paste-on-vps>`);

  for (const r of results) {
    console.log(`\n# ── .env.${r.role} ──`);
    console.log(`BOT_ROLE=${r.role}`);
    console.log(`ARCLAYER_AGENT_ID=${r.agentId}`);
    console.log(`ARCLAYER_API_KEY=${r.apiKey}`);
    console.log(`RUNTIME_ID=${r.role}-runtime-01`);
    console.log(`ARCLAYER_ERC8004_ID=erc8004_identity_registry:${r.agentId}`);
    console.log(`AGENT_CATEGORY=prediction-market-bots`);
  }

  console.log(`\n✅ DONE. All 4 bots registered + keys generated.`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
