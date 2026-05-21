import 'dotenv/config';
import {
  arcTestnet,
  buildErc8183CreateJobConfig,
  buildErc8183FundConfig,
  buildErc8183SetBudgetConfig,
  buildUsdcApproveForJobConfig,
} from '@arclayer/sdk';
import { createPublicClient, createWalletClient, fallback, getAddress, http, parseEventLogs, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ERC8183_ABI = buildErc8183CreateJobConfig(
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000',
  0n,
  'abi-probe',
).abi;

type SupabaseRow = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalAddress(name: string, fallback: Address): Address {
  const value = process.env[name];
  return value ? getAddress(value as Address) : fallback;
}

function transports() {
  const urls = [process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network', process.env.ARC_RPC_FALLBACK_URL || 'https://rpc.drpc.testnet.arc.network'];
  return fallback(urls.map((url) => http(url, { timeout: 10_000 })));
}

function supabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
}

async function upsertA2AJob(row: SupabaseRow) {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to mirror a2a_jobs');

  const res = await fetch(`${url}/rest/v1/a2a_jobs`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase mirror failed ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const clientPk = required('CLIENT_PRIVATE_KEY') as Hex;
  const providerPk = required('WORKER_PRIVATE_KEY') as Hex;
  const evaluatorPk = required('EVALUATOR_PRIVATE_KEY') as Hex;
  const budgetAtomic = BigInt(process.env.SMOKE_BUDGET_ATOMIC || '1000');
  const description = process.env.SMOKE_JOB_DESCRIPTION || `ArcLayer ERC-8183 worker smoke ${new Date().toISOString()}`;
  const expiresInSec = BigInt(Number(process.env.SMOKE_EXPIRES_IN_SECONDS || '3600'));

  const clientAccount = privateKeyToAccount(clientPk);
  const provider = optionalAddress('SMOKE_PROVIDER_ADDRESS', privateKeyToAccount(providerPk).address);
  const evaluator = optionalAddress('SMOKE_EVALUATOR_ADDRESS', privateKeyToAccount(evaluatorPk).address);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: transports() });
  const walletClient = createWalletClient({ account: clientAccount, chain: arcTestnet, transport: transports() });
  const expiredAt = BigInt(Math.floor(Date.now() / 1000)) + expiresInSec;

  const createTx = await walletClient.writeContract({ account: clientAccount, chain: arcTestnet, ...buildErc8183CreateJobConfig(provider, evaluator, expiredAt, description) });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
  if (createReceipt.status !== 'success') throw new Error(`createJob failed: ${createTx}`);

  const [created] = parseEventLogs({ abi: ERC8183_ABI, logs: createReceipt.logs, eventName: 'JobCreated' });
  const onchainJobId = String((created.args as { jobId: bigint }).jobId);

  const approveTx = await walletClient.writeContract({ account: clientAccount, chain: arcTestnet, ...buildUsdcApproveForJobConfig(budgetAtomic) });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
  if (approveReceipt.status !== 'success') throw new Error(`USDC approve failed: ${approveTx}`);

  const setBudgetTx = await walletClient.writeContract({ account: clientAccount, chain: arcTestnet, ...buildErc8183SetBudgetConfig(BigInt(onchainJobId), budgetAtomic) });
  const setBudgetReceipt = await publicClient.waitForTransactionReceipt({ hash: setBudgetTx });
  if (setBudgetReceipt.status !== 'success') throw new Error(`setBudget failed: ${setBudgetTx}`);

  const fundTx = await walletClient.writeContract({ account: clientAccount, chain: arcTestnet, ...buildErc8183FundConfig(BigInt(onchainJobId)) });
  const fundReceipt = await publicClient.waitForTransactionReceipt({ hash: fundTx });
  if (fundReceipt.status !== 'success') throw new Error(`fund failed: ${fundTx}`);

  const id = `erc8183_smoke_${onchainJobId}`;
  const now = new Date().toISOString();
  await upsertA2AJob({
    id,
    title: 'ERC-8183 worker smoke',
    description,
    category: 'smoke',
    role_id: 'submitter',
    budget: String(budgetAtomic),
    requester: clientAccount.address,
    agent_id: null,
    claimed_by: null,
    status: 'open',
    input: { smoke: true, onchainJobId },
    output: null,
    proof: null,
    created_at: now,
    claimed_at: null,
    submitted_at: null,
    is_onchain: true,
    onchain_job_id: onchainJobId,
    provider,
    evaluator,
    budget_atomic: String(budgetAtomic),
    fund_tx: fundTx,
    submit_tx: null,
    complete_tx: null,
    settlement_status: 1,
    deliverable_uri: null,
    deliverable_hash: null,
    proof_uri: null,
  });

  console.log(JSON.stringify({ ok: true, id, onchainJobId, provider, evaluator, budgetAtomic: String(budgetAtomic), createTx, approveTx, setBudgetTx, fundTx }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
