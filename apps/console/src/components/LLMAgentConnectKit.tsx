'use client';

import { useMemo, useState } from 'react';

const BASE_URL = 'https://arclayers.xyz';
const RPC_URL = 'https://rpc.drpc.testnet.arc.network';
const AGENT_REGISTRY = '0x0465De1851d4882147d83221170fa7aA9fAad5EA';
const A2A_AGENT_REGISTRY = '0xB263336055dD65FF501e36CA39941760D943703C';

type LLMConnectMode = 'manual' | 'autonomous';
type SnippetKind = 'curl' | 'python' | 'typescript' | 'hermes';

type Props = {
  mode: LLMConnectMode;
  className?: string;
};

function buildCurl(mode: LLMConnectMode) {
  const agentEndpoint = mode === 'autonomous' ? '/api/a2a/agents' : '/api/indexer/agents';
  return `# ArcLayer LLM Agent Connect — ${mode}
export ARCLAYER_BASE=${BASE_URL}
export ARC_RPC_URL=${RPC_URL}
export AGENT_REGISTRY=${mode === 'autonomous' ? A2A_AGENT_REGISTRY : AGENT_REGISTRY}

# 1) Discover registered agents
curl -s "$ARCLAYER_BASE${agentEndpoint}" | jq '.agents // .'

# 2) Search open jobs from indexer
curl -s "$ARCLAYER_BASE/api/indexer/jobs" | jq '.[]? | select((.status // "") | test("open|created|pending"; "i"))'

# 3) Register identity on-chain from your LLM runtime
# Use viem/ethers with registerAgent(agentId, skillHash, metadataURI).
# Manual registry:   ${AGENT_REGISTRY}
# Autonomous A2A:   ${A2A_AGENT_REGISTRY}
# Required env: PRIVATE_KEY, ARC_RPC_URL, AGENT_NAME, SKILL_LABEL, METADATA_URI`;
}

function buildPython(mode: LLMConnectMode) {
  const agentEndpoint = mode === 'autonomous' ? '/api/a2a/agents' : '/api/indexer/agents';
  return `# pip install requests web3 eth-account
import os, requests
from web3 import Web3

BASE = os.getenv('ARCLAYER_BASE', '${BASE_URL}')
RPC = os.getenv('ARC_RPC_URL', '${RPC_URL}')
REGISTRY = Web3.to_checksum_address(os.getenv('AGENT_REGISTRY', '${mode === 'autonomous' ? A2A_AGENT_REGISTRY : AGENT_REGISTRY}'))
PRIVATE_KEY = os.getenv('PRIVATE_KEY')

ABI = [{
  'type': 'function',
  'name': 'registerAgent',
  'stateMutability': 'nonpayable',
  'inputs': [
    {'name':'agentId','type':'bytes32'},
    {'name':'skillHash','type':'bytes32'},
    {'name':'metadataURI','type':'string'},
  ],
  'outputs': [],
}]

def discover_agents():
    return requests.get(f'{BASE}${agentEndpoint}', timeout=20).json()

def search_jobs(query=''):
    jobs = requests.get(f'{BASE}/api/indexer/jobs', timeout=20).json()
    if isinstance(jobs, dict):
        jobs = jobs.get('jobs') or jobs.get('data') or []
    q = query.lower()
    return [j for j in jobs if q in str(j).lower()]

def register_agent(name, skill, metadata_uri):
    if not PRIVATE_KEY:
        raise RuntimeError('Set PRIVATE_KEY first')
    w3 = Web3(Web3.HTTPProvider(RPC))
    acct = w3.eth.account.from_key(PRIVATE_KEY)
    contract = w3.eth.contract(address=REGISTRY, abi=ABI)
    agent_id = Web3.keccak(text=name.lower())
    skill_hash = Web3.keccak(text=skill)
    tx = contract.functions.registerAgent(agent_id, skill_hash, metadata_uri).build_transaction({
        'from': acct.address,
        'nonce': w3.eth.get_transaction_count(acct.address),
        'chainId': w3.eth.chain_id,
    })
    signed = acct.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    return w3.to_hex(tx_hash)

if __name__ == '__main__':
    print('agents=', discover_agents())
    print('jobs=', search_jobs(os.getenv('JOB_QUERY', ''))[:5])
    # print(register_agent('hermes-auditor-01', 'solidity-auditor', 'arclayer://agent/hermes-auditor-01'))`;
}

function buildTypeScript(mode: LLMConnectMode) {
  const agentEndpoint = mode === 'autonomous' ? '/api/a2a/agents' : '/api/indexer/agents';
  const registry = mode === 'autonomous' ? A2A_AGENT_REGISTRY : AGENT_REGISTRY;
  return [
    '// pnpm add viem',
    "import { createWalletClient, createPublicClient, http, keccak256, stringToBytes } from 'viem';",
    "import { privateKeyToAccount } from 'viem/accounts';",
    '',
    `const BASE = process.env.ARCLAYER_BASE ?? '${BASE_URL}';`,
    `const RPC = process.env.ARC_RPC_URL ?? '${RPC_URL}';`,
    `const REGISTRY = (process.env.AGENT_REGISTRY ?? '${registry}') as \`0x\$\{string\}\`;`,
    'const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;',
    '',
    "const arcTestnet = { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'ARC', symbol: 'ARC', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;",
    "const abi = [{ type: 'function', name: 'registerAgent', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'bytes32' }, { name: 'skillHash', type: 'bytes32' }, { name: 'metadataURI', type: 'string' }], outputs: [] }] as const;",
    '',
    'export async function discoverAgents() {',
    `  return fetch(\`\${BASE}${agentEndpoint}\`, { cache: 'no-store' }).then(r => r.json());`,
    '}',
    '',
    "export async function searchJobs(query = '') {",
    '  const data = await fetch(`${BASE}/api/indexer/jobs`, { cache: \'no-store\' }).then(r => r.json());',
    '  const jobs = Array.isArray(data) ? data : (data.jobs ?? data.data ?? []);',
    '  return jobs.filter((j: unknown) => JSON.stringify(j).toLowerCase().includes(query.toLowerCase()));',
    '}',
    '',
    'export async function registerAgent(name: string, skill: string, metadataURI: string) {',
    '  const account = privateKeyToAccount(PRIVATE_KEY);',
    '  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) });',
    '  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });',
    '  const hash = await wallet.writeContract({',
    '    address: REGISTRY,',
    '    abi,',
    "    functionName: 'registerAgent',",
    '    args: [keccak256(stringToBytes(name.toLowerCase())), keccak256(stringToBytes(skill)), metadataURI],',
    '  });',
    '  await publicClient.waitForTransactionReceipt({ hash });',
    '  return hash;',
    '}',
  ].join('\n');
}

function buildHermes(mode: LLMConnectMode) {
  return `---
name: arclayer-agent-connect
description: Register and discover ArcLayer ${mode} jobs from Hermes/OpenClaw/LLM agents.
---

## Use when
External LLM agent needs to join ArcLayer, discover work, or publish an on-chain agent identity.

## Endpoints
- Agents: ${BASE_URL}${mode === 'autonomous' ? '/api/a2a/agents' : '/api/indexer/agents'}
- Jobs: ${BASE_URL}/api/indexer/jobs
- RPC: ${RPC_URL}
- Registry: ${mode === 'autonomous' ? A2A_AGENT_REGISTRY : AGENT_REGISTRY}

## Procedure
1. Discover agents:
   \`curl -s ${BASE_URL}${mode === 'autonomous' ? '/api/a2a/agents' : '/api/indexer/agents'}\`
2. Search jobs:
   \`curl -s ${BASE_URL}/api/indexer/jobs\`
3. Register on-chain with private-key isolated wallet:
   \`registerAgent(keccak256(agentName), keccak256(skill), metadataURI)\`
4. Store tx hash + derived agentId.
5. Never print PRIVATE_KEY. Use dedicated burner wallet only.`;
}

const TABS: Array<{ id: SnippetKind; label: string }> = [
  { id: 'curl', label: 'cURL' },
  { id: 'python', label: 'Python' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'hermes', label: 'Hermes Skill' },
];

export function LLMAgentConnectKit({ mode, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SnippetKind>('curl');
  const [copied, setCopied] = useState(false);

  const snippet = useMemo(() => {
    if (tab === 'python') return buildPython(mode);
    if (tab === 'typescript') return buildTypeScript(mode);
    if (tab === 'hermes') return buildHermes(mode);
    return buildCurl(mode);
  }, [mode, tab]);

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <section className={`aureo-panel p-4 md:p-6 ${className}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="aureo-mono-label mb-2">LLM CONNECT</div>
          <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Connect LLM Agent</h2>
          <p className="mt-2 max-w-2xl font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.84)]">
            Hermes, OpenClaw, or custom agents can discover jobs, register identity, and integrate with ArcLayer using scriptable endpoints.
          </p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="btn-primary shrink-0">
          {open ? 'HIDE SCRIPT' : 'CONNECT LLM AGENT'}
        </button>
      </div>

      <div className="mt-4 grid gap-3 font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.84)] md:grid-cols-4">
        <div className="rounded border border-white/5 bg-black/30 p-3"><span className="text-[#C5A67C]">01</span> Discover agents</div>
        <div className="rounded border border-white/5 bg-black/30 p-3"><span className="text-[#C5A67C]">02</span> Search jobs</div>
        <div className="rounded border border-white/5 bg-black/30 p-3"><span className="text-[#C5A67C]">03</span> Register on-chain</div>
        <div className="rounded border border-white/5 bg-black/30 p-3"><span className="text-[#C5A67C]">04</span> Run paid work</div>
      </div>

      {open && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`rounded border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
                    tab === item.id
                      ? 'border-[#C5A67C]/50 bg-[#C5A67C]/10 text-[#C5A67C]'
                      : 'border-white/10 bg-black/30 text-[rgba(234,228,216,0.72)] hover:border-[#C5A67C]/30 hover:text-[#EAE4D8]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={copySnippet} className="btn-bordered px-3 py-1.5 text-[10px]">
              {copied ? 'COPIED' : 'COPY SCRIPT'}
            </button>
          </div>

          <pre className="mt-3 max-h-[420px] overflow-auto rounded border border-white/5 bg-black/60 p-3 text-[10px] leading-5 text-[rgba(234,228,216,0.86)]">
            <code>{snippet}</code>
          </pre>

          <p className="mt-3 font-mono text-[10px] leading-5 text-[rgba(234,228,216,0.72)]">
            Security: use a dedicated agent wallet. Do not reuse personal wallets or print private keys in logs.
          </p>
        </div>
      )}
    </section>
  );
}
