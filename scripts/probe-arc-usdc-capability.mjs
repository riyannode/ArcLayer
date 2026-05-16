#!/usr/bin/env node
/**
 * Arc USDC capability probe — read-only.
 *
 * Verifies which standards Arc Testnet USDC supports, so we can decide
 * which x402 V2 exact-transfer scheme to ship first.
 *
 *   - ERC-20 basics: name, symbol, decimals
 *   - EIP-712 domain: DOMAIN_SEPARATOR (if exposed)
 *   - EIP-2612 permit: nonces(address)
 *   - EIP-3009 transferWithAuthorization: authorizationState(address,bytes32)
 *   - Permit2 deployment: 0x000000000022D473030F116dDEE9F6B43aC78BA3
 *
 * Run:
 *   node scripts/probe-arc-usdc-capability.mjs
 *   node scripts/probe-arc-usdc-capability.mjs --json
 *   node scripts/probe-arc-usdc-capability.mjs --report > docs/x402/arc-capability-report.md
 *
 * Pure Node 20+ — no extra deps.
 */

const ARC = {
  chainId: 5042002,
  rpc: process.env.ARC_RPC || 'https://rpc.testnet.arc.network',
  explorer: 'https://testnet.arcscan.app',
  usdc: '0x3600000000000000000000000000000000000000',
};

// Canonical Permit2 (Uniswap) — same address on every supported chain.
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// ─── tiny RPC + ABI encoders (no deps) ───────────────────────────────────────

let rpcId = 1;
async function rpc(method, params) {
  const res = await fetch(ARC.rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

const SELECTORS = {
  name:               '0x06fdde03',
  symbol:             '0x95d89b41',
  decimals:           '0x313ce567',
  DOMAIN_SEPARATOR:   '0x3644e515',
  nonces:             '0x7ecebe00', // nonces(address)
  authorizationState: '0xe94a0102', // authorizationState(address,bytes32)
};

const pad32 = (hexNoPrefix) => hexNoPrefix.padStart(64, '0');
const stripHex = (h) => (h.startsWith('0x') ? h.slice(2) : h);

function encodeAddress(addr) { return pad32(stripHex(addr).toLowerCase()); }
function encodeBytes32(b32)  { return pad32(stripHex(b32)); }

function decodeUint(hex) {
  if (!hex || hex === '0x') return null;
  return BigInt(hex);
}

function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  const data = stripHex(hex);
  // dynamic ABI string: offset(32) + length(32) + bytes
  if (data.length < 128) return null;
  const len = parseInt(data.slice(64, 128), 16);
  if (!Number.isFinite(len) || len === 0) return null;
  const bytes = data.slice(128, 128 + len * 2);
  try {
    return Buffer.from(bytes, 'hex').toString('utf8');
  } catch {
    return null;
  }
}

async function ethCall(to, data) {
  try {
    return await rpc('eth_call', [{ to, data }, 'latest']);
  } catch (e) {
    return { __error: e.message };
  }
}

async function readUint(addr, selector) {
  const r = await ethCall(addr, selector);
  if (r && typeof r === 'object' && r.__error) return { error: r.__error };
  return { value: decodeUint(r) };
}

async function readString(addr, selector) {
  const r = await ethCall(addr, selector);
  if (r && typeof r === 'object' && r.__error) return { error: r.__error };
  return { value: decodeString(r) };
}

async function readBytes32(addr, selector) {
  const r = await ethCall(addr, selector);
  if (r && typeof r === 'object' && r.__error) return { error: r.__error };
  return { value: r };
}

// ─── probes ──────────────────────────────────────────────────────────────────

async function probeErc20(usdc) {
  const [name, symbol, decimals] = await Promise.all([
    readString(usdc, SELECTORS.name),
    readString(usdc, SELECTORS.symbol),
    readUint(usdc, SELECTORS.decimals),
  ]);
  return { name, symbol, decimals };
}

async function probeDomainSeparator(usdc) {
  return readBytes32(usdc, SELECTORS.DOMAIN_SEPARATOR);
}

async function probeEip2612(usdc) {
  // call nonces(address) with the zero address — any address with a valid implementation returns 0+
  const data = SELECTORS.nonces + encodeAddress('0x0000000000000000000000000000000000000000');
  const r = await ethCall(usdc, data);
  if (r && typeof r === 'object' && r.__error) {
    return { supported: false, error: r.__error };
  }
  if (!r || r === '0x') {
    return { supported: false, reason: 'empty return' };
  }
  return { supported: true, nonceForZero: decodeUint(r)?.toString() ?? null };
}

async function probeEip3009(usdc) {
  // authorizationState(address,bytes32) with zero address + zero nonce.
  const data =
    SELECTORS.authorizationState +
    encodeAddress('0x0000000000000000000000000000000000000000') +
    encodeBytes32('0x0000000000000000000000000000000000000000000000000000000000000000');
  const r = await ethCall(usdc, data);
  if (r && typeof r === 'object' && r.__error) {
    return { supported: false, error: r.__error };
  }
  if (!r || r === '0x') {
    return { supported: false, reason: 'empty return' };
  }
  // returns bool — false (used=false) is fine, just means the function exists
  return { supported: true, raw: r };
}

async function probePermit2() {
  try {
    const code = await rpc('eth_getCode', [PERMIT2, 'latest']);
    const deployed = typeof code === 'string' && code !== '0x' && code.length > 4;
    return { address: PERMIT2, deployed, codeSize: deployed ? (code.length - 2) / 2 : 0 };
  } catch (e) {
    return { address: PERMIT2, deployed: false, error: e.message };
  }
}

async function probeChain() {
  try {
    const id = await rpc('eth_chainId', []);
    const block = await rpc('eth_blockNumber', []);
    return { chainId: parseInt(id, 16), blockNumber: parseInt(block, 16) };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── orchestration ───────────────────────────────────────────────────────────

async function runProbe() {
  const chain = await probeChain();
  const erc20 = await probeErc20(ARC.usdc);
  const domain = await probeDomainSeparator(ARC.usdc);
  const eip2612 = await probeEip2612(ARC.usdc);
  const eip3009 = await probeEip3009(ARC.usdc);
  const permit2 = await probePermit2();

  return {
    timestamp: new Date().toISOString(),
    network: {
      name: 'Arc Testnet',
      chainId: ARC.chainId,
      rpc: ARC.rpc,
      explorer: ARC.explorer,
      observed: chain,
    },
    usdc: {
      address: ARC.usdc,
      erc20,
      domainSeparator: domain,
      eip2612,
      eip3009,
    },
    permit2,
  };
}

function decisionFor(result) {
  const has3009 = result.usdc.eip3009?.supported === true;
  const has2612 = result.usdc.eip2612?.supported === true;
  const hasPermit2 = result.permit2?.deployed === true;

  let preferred = 'inconclusive';
  if (has3009) preferred = 'eip3009';
  else if (hasPermit2) preferred = 'permit2';
  else if (has2612) preferred = 'eip2612 (degraded — not native x402 V2 scheme)';

  return {
    eip3009: has3009 ? 'supported' : 'not detected',
    eip2612: has2612 ? 'supported' : 'not detected',
    permit2: hasPermit2 ? 'deployed' : 'not detected',
    preferredX402Scheme: preferred,
  };
}

function formatReport(result) {
  const d = decisionFor(result);
  const erc = result.usdc.erc20;
  const lines = [];
  lines.push('# Arc USDC Capability Report');
  lines.push('');
  lines.push(`Generated: \`${result.timestamp}\``);
  lines.push(`Probe: \`scripts/probe-arc-usdc-capability.mjs\` (read-only)`);
  lines.push('');
  lines.push('## Network');
  lines.push('');
  lines.push(`- Name: ${result.network.name}`);
  lines.push(`- Chain ID (declared): ${result.network.chainId}`);
  lines.push(`- Chain ID (observed via \`eth_chainId\`): ${result.network.observed?.chainId ?? 'n/a'}`);
  lines.push(`- Latest block: ${result.network.observed?.blockNumber ?? 'n/a'}`);
  lines.push(`- RPC: ${result.network.rpc}`);
  lines.push(`- Explorer: ${result.network.explorer}`);
  lines.push('');
  lines.push('## USDC');
  lines.push('');
  lines.push(`- Address: \`${result.usdc.address}\``);
  lines.push(`- name(): ${erc?.name?.value ?? `error: ${erc?.name?.error ?? 'n/a'}`}`);
  lines.push(`- symbol(): ${erc?.symbol?.value ?? `error: ${erc?.symbol?.error ?? 'n/a'}`}`);
  lines.push(`- decimals(): ${erc?.decimals?.value?.toString() ?? `error: ${erc?.decimals?.error ?? 'n/a'}`}`);
  const ds = result.usdc.domainSeparator;
  lines.push(`- DOMAIN_SEPARATOR(): ${ds?.value && ds.value !== '0x' ? `\`${ds.value}\`` : ds?.error ? `error: ${ds.error}` : 'not exposed'}`);
  lines.push('');
  lines.push('## Standards');
  lines.push('');
  lines.push('### EIP-3009 — transferWithAuthorization');
  lines.push('');
  if (result.usdc.eip3009.supported) {
    lines.push('- ✅ `authorizationState(address,bytes32)` returned data — function exists.');
  } else {
    lines.push(`- ❌ Not detected (${result.usdc.eip3009.error || result.usdc.eip3009.reason || 'no return'}).`);
  }
  lines.push('');
  lines.push('### EIP-2612 — permit');
  lines.push('');
  if (result.usdc.eip2612.supported) {
    lines.push(`- ✅ \`nonces(address)\` returned ${result.usdc.eip2612.nonceForZero ?? 'data'} — function exists.`);
  } else {
    lines.push(`- ❌ Not detected (${result.usdc.eip2612.error || result.usdc.eip2612.reason || 'no return'}).`);
  }
  lines.push('');
  lines.push('### Permit2 (Uniswap canonical)');
  lines.push('');
  if (result.permit2.deployed) {
    lines.push(`- ✅ Deployed at \`${result.permit2.address}\` (codeSize=${result.permit2.codeSize}).`);
  } else {
    lines.push(`- ❌ Not deployed at canonical address \`${result.permit2.address}\`${result.permit2.error ? ` (${result.permit2.error})` : ''}.`);
  }
  lines.push('');
  lines.push('## Decision');
  lines.push('');
  lines.push('| Capability | Status |');
  lines.push('|---|---|');
  lines.push(`| EIP-3009 | ${d.eip3009} |`);
  lines.push(`| EIP-2612 | ${d.eip2612} |`);
  lines.push(`| Permit2 | ${d.permit2} |`);
  lines.push(`| Preferred x402 V2 scheme | **${d.preferredX402Scheme}** |`);
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- This probe does not write any state and does not require funded wallets.');
  lines.push('- A successful `eth_call` to a selector indicates the function exists; full');
  lines.push('  spec compliance still requires runtime testing (signature verification,');
  lines.push('  nonce mechanics, replay protection).');
  lines.push('- If `DOMAIN_SEPARATOR` is missing but `nonces`/`authorizationState` exist,');
  lines.push('  the contract may build the domain inline per call — not a blocker.');
  lines.push('- Re-run after any USDC contract upgrade on Arc Testnet.');
  lines.push('');
  return lines.join('\n');
}

// ─── main ────────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));
const result = await runProbe();

if (args.has('--json')) {
  process.stdout.write(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  process.stdout.write('\n');
} else if (args.has('--report')) {
  process.stdout.write(formatReport(result));
} else {
  // Friendly default: print report to stdout
  process.stdout.write(formatReport(result));
}
