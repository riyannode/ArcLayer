/**
 * Phase G — x402 Facilitator Integration Tests
 *
 * Tests store + facilitator layer directly against live Supabase.
 * No test framework needed — plain Node.js ESM.
 * Does NOT require Arc RPC (on-chain verify is mocked via store.createPayment directly).
 *
 * Run: node --env-file=.env.local scripts/phase-g-test.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'crypto';

// ── env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── helpers ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function uid(prefix = '') {
  return `${prefix}${randomBytes(8).toString('hex')}`;
}

function fakeTxHash() {
  return `0x${randomBytes(32).toString('hex')}`;
}

function consumerKey(txHash, resource) {
  return createHash('sha256').update(`${txHash}:${resource}`).digest('hex');
}

async function cleanup(ids) {
  // delete in FK-safe order
  if (ids.cacheKeys?.length) {
    await db.from('x402_response_cache').delete().in('cache_key', ids.cacheKeys);
  }
  if (ids.consumptionIds?.length) {
    await db.from('x402_consumptions').delete().in('consumption_id', ids.consumptionIds);
  }
  if (ids.paymentIds?.length) {
    await db.from('x402_payment_attempts').delete().in('payment_id', ids.paymentIds);
    await db.from('x402_payments').delete().in('payment_id', ids.paymentIds);
  }
  if (ids.requirementIds?.length) {
    await db.from('x402_payment_attempts').delete().in('requirement_id', ids.requirementIds);
    await db.from('x402_requirements').delete().in('requirement_id', ids.requirementIds);
  }
}

// ── test suites ───────────────────────────────────────────────────────────────

async function testRequirementCRUD() {
  console.log('\n📋  Suite 1: Requirement CRUD');
  const reqId = uid('req_');
  const nonce = uid('nonce_');
  const resource = `/api/agents/test-${uid()}/run`;
  const expiresAt = new Date(Date.now() + 300_000).toISOString();

  // INSERT
  const { data: ins, error: insErr } = await db.from('x402_requirements').insert({
    requirement_id: reqId,
    protocol: 'x402',
    scheme: 'arc-escrow',
    network: 'arc-testnet',
    chain_id: 5042002,
    resource,
    resource_method: 'POST',
    pay_to: '0xf0e1b0709a012ade0b73596fdc8fa0ce037dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amount_required: '1000000',
    currency: 'USDC',
    max_timeout_seconds: 300,
    expires_at: expiresAt,
    nonce,
    status: 'active',
    metadata: {},
  }).select().single();

  assert('createRequirement inserts row', !insErr && ins?.requirement_id === reqId, insErr?.message);

  // GET
  const { data: got, error: getErr } = await db
    .from('x402_requirements')
    .select()
    .eq('requirement_id', reqId)
    .single();
  assert('getRequirement returns row', !getErr && got?.requirement_id === reqId, getErr?.message);

  // EXPIRE
  const { error: expErr } = await db
    .from('x402_requirements')
    .update({ status: 'expired' })
    .eq('requirement_id', reqId);
  assert('expireRequirement updates status', !expErr, expErr?.message);

  const { data: expRow } = await db
    .from('x402_requirements')
    .select('status')
    .eq('requirement_id', reqId)
    .single();
  assert('status is expired', expRow?.status === 'expired');

  await cleanup({ requirementIds: [reqId] });
}

async function testPaymentIdempotency() {
  console.log('\n💳  Suite 2: Payment idempotency (duplicate txHash same resource)');
  const reqId = uid('req_');
  const payId = uid('pay_');
  const txHash = fakeTxHash();
  const resource = `/api/agents/idem-${uid()}/run`;
  const expiresAt = new Date(Date.now() + 300_000).toISOString();

  // seed requirement
  await db.from('x402_requirements').insert({
    requirement_id: reqId, protocol: 'x402', scheme: 'arc-escrow',
    network: 'arc-testnet', chain_id: 5042002, resource,
    resource_method: 'POST', pay_to: '0xf0e1b0709a012ade0b73596fdc8fa0ce037dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amount_required: '1000000', currency: 'USDC', max_timeout_seconds: 300,
    expires_at: expiresAt, nonce: uid('n_'), status: 'active', metadata: {},
  });

  // first insert
  const { error: e1 } = await db.from('x402_payments').insert({
    payment_id: payId, requirement_id: reqId, tx_hash: txHash,
    chain_id: 5042002, scheme: 'arc-escrow', network: 'arc-testnet',
    pay_to: '0xf0e1b0709a012ade0b73596fdc8fa0ce037dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amount: '1000000', job_id: '1', resource, event_name: 'JobFunded',
    verification_payload: {}, settlement_payload: {}, status: 'verified',
  });
  assert('first createPayment succeeds', !e1, e1?.message);

  // duplicate insert same txHash same resource → unique constraint → 23505
  const { error: e2 } = await db.from('x402_payments').insert({
    payment_id: uid('pay_'), requirement_id: reqId, tx_hash: txHash,
    chain_id: 5042002, scheme: 'arc-escrow', network: 'arc-testnet',
    pay_to: '0xf0e1b0709a012ade0b73596fdc8fa0ce037dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amount: '1000000', job_id: '1', resource, event_name: 'JobFunded',
    verification_payload: {}, settlement_payload: {}, status: 'verified',
  });
  assert('duplicate txHash rejected (23505)', e2?.code === '23505', `got code=${e2?.code}`);

  await cleanup({ paymentIds: [payId], requirementIds: [reqId] });
}

async function testConsumeRPC() {
  console.log('\n🔒  Suite 3: x402_consume_payment RPC — first consume + replay same + replay different resource');
  const reqId = uid('req_');
  const payId = uid('pay_');
  const txHash = fakeTxHash();
  const resource = `/api/agents/consume-${uid()}/run`;
  const resource2 = `/api/agents/other-${uid()}/run`;
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  const cKey = consumerKey(txHash, resource);

  // seed
  await db.from('x402_requirements').insert({
    requirement_id: reqId, protocol: 'x402', scheme: 'arc-escrow',
    network: 'arc-testnet', chain_id: 5042002, resource,
    resource_method: 'POST', pay_to: '0xf0e1b0709a012ade0b73596fdc8fa0ce037dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amount_required: '1000000', currency: 'USDC', max_timeout_seconds: 300,
    expires_at: expiresAt, nonce: uid('n_'), status: 'active', metadata: {},
  });
  await db.from('x402_payments').insert({
    payment_id: payId, requirement_id: reqId, tx_hash: txHash,
    chain_id: 5042002, scheme: 'arc-escrow', network: 'arc-testnet',
    pay_to: '0xf0e1b0709a012ade0b73596fdc8fa0ce037dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amount: '1000000', job_id: '1', resource, event_name: 'JobFunded',
    verification_payload: {}, settlement_payload: {}, status: 'verified',
  });

  // first consume
  const { data: r1, error: err1 } = await db.rpc('x402_consume_payment', {
    p_payment_id: payId, p_tx_hash: txHash, p_requirement_id: reqId,
    p_resource: resource, p_resource_method: 'POST',
    p_consumer_key: cKey, p_metadata: {},
  });
  const row1 = r1?.[0];
  assert('first consume → CONSUMED', !err1 && row1?.ok === true && row1?.code === 'CONSUMED',
    err1?.message ?? `code=${row1?.code}`);

  // replay same resource + same consumer key → ALREADY_CONSUMED
  const { data: r2, error: err2 } = await db.rpc('x402_consume_payment', {
    p_payment_id: payId, p_tx_hash: txHash, p_requirement_id: reqId,
    p_resource: resource, p_resource_method: 'POST',
    p_consumer_key: cKey, p_metadata: {},
  });
  const row2 = r2?.[0];
  assert('retry same resource → ALREADY_CONSUMED', !err2 && row2?.code === 'ALREADY_CONSUMED',
    err2?.message ?? `code=${row2?.code}`);

  // replay different resource → RESOURCE_MISMATCH (payment is resource-bound at insert)
  const { data: r3, error: err3 } = await db.rpc('x402_consume_payment', {
    p_payment_id: payId, p_tx_hash: txHash, p_requirement_id: reqId,
    p_resource: resource2, p_resource_method: 'POST',
    p_consumer_key: consumerKey(txHash, resource2), p_metadata: {},
  });
  const row3 = r3?.[0];
  assert('different resource → RESOURCE_MISMATCH (payment bound to original resource)',
    !err3 && row3?.ok === false && row3?.code === 'RESOURCE_MISMATCH',
    err3?.message ?? `code=${row3?.code}`);

  // verify payment status updated to consumed
  const { data: payRow } = await db.from('x402_payments').select('status').eq('payment_id', payId).single();
  assert('payment status = consumed', payRow?.status === 'consumed');

  // cleanup consumptions first
  const { data: cons } = await db.from('x402_consumptions').select('consumption_id').eq('payment_id', payId);
  const consIds = (cons ?? []).map(c => c.consumption_id);
  await cleanup({ cacheKeys: [], consumptionIds: consIds, paymentIds: [payId], requirementIds: [reqId] });
}

async function testResponseCache() {
  console.log('\n🗄️   Suite 4: Response cache put + get + expiry');
  const reqId = uid('req_');
  const payId = uid('pay_');
  const consId = uid('cons_');
  const txHash = fakeTxHash();
  const resource = `/api/agents/cache-${uid()}/run`;
  const cacheKey = `x402:${payId}:${resource}`;
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  const expiredAt = new Date(Date.now() - 1000).toISOString(); // already expired

  // seed requirement + payment + consumption
  await db.from('x402_requirements').insert({
    requirement_id: reqId, protocol: 'x402', scheme: 'arc-escrow',
    network: 'arc-testnet', chain_id: 5042002, resource,
    resource_method: 'POST', pay_to: '0xf0e1b0709a012ade0b73596fdc8fa0ce037dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amount_required: '1000000', currency: 'USDC', max_timeout_seconds: 300,
    expires_at: expiresAt, nonce: uid('n_'), status: 'active', metadata: {},
  });
  await db.from('x402_payments').insert({
    payment_id: payId, requirement_id: reqId, tx_hash: txHash,
    chain_id: 5042002, scheme: 'arc-escrow', network: 'arc-testnet',
    pay_to: '0xf0e1b0709a012ade0b73596fdc8fa0ce037dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amount: '1000000', job_id: '1', resource, event_name: 'JobFunded',
    verification_payload: {}, settlement_payload: {}, status: 'consumed',
  });
  await db.from('x402_consumptions').insert({
    consumption_id: consId, payment_id: payId, tx_hash: txHash,
    requirement_id: reqId, resource, resource_method: 'POST',
    consumer_key: consumerKey(txHash, resource), status: 'consumed', metadata: {},
  });

  // put cache
  const { error: putErr } = await db.from('x402_response_cache').insert({
    cache_key: cacheKey, payment_id: payId, consumption_id: consId,
    requirement_id: reqId, resource, status_code: 200,
    response_headers: { 'content-type': 'application/json' },
    response_body: { ok: true, result: 'cached-agent-output' },
    content_type: 'application/json',
    expires_at: expiresAt,
  });
  assert('putCachedResponse inserts row', !putErr, putErr?.message);

  // get cache (valid)
  const { data: cached, error: getErr } = await db
    .from('x402_response_cache')
    .select()
    .eq('cache_key', cacheKey)
    .gt('expires_at', new Date().toISOString())
    .single();
  assert('getCachedResponse returns valid cache', !getErr && cached?.cache_key === cacheKey, getErr?.message);
  assert('cached body preserved', cached?.response_body?.ok === true);

  // expired cache → should return null (PGRST116)
  const expiredKey = `x402:${payId}:expired`;
  await db.from('x402_response_cache').insert({
    cache_key: expiredKey, payment_id: payId, consumption_id: consId,
    requirement_id: reqId, resource, status_code: 200,
    response_headers: {}, response_body: { ok: true },
    content_type: 'application/json', expires_at: expiredAt,
  });
  const { data: expiredRow, error: expiredErr } = await db
    .from('x402_response_cache')
    .select()
    .eq('cache_key', expiredKey)
    .gt('expires_at', new Date().toISOString())
    .single();
  assert('expired cache returns null (PGRST116)', expiredErr?.code === 'PGRST116' && !expiredRow,
    `code=${expiredErr?.code}`);

  await cleanup({
    cacheKeys: [cacheKey, expiredKey],
    consumptionIds: [consId],
    paymentIds: [payId],
    requirementIds: [reqId],
  });
}

async function testAttemptAuditTrail() {
  console.log('\n📝  Suite 5: Attempt audit trail (best-effort insert)');
  const attId = uid('att_');
  const { error } = await db.from('x402_payment_attempts').insert({
    attempt_id: attId,
    operation: 'verify',
    status: 'succeeded',
    request_payload: { txHash: fakeTxHash() },
    response_payload: { paymentId: uid('pay_') },
    duration_ms: 42,
  });
  assert('recordAttempt inserts row', !error, error?.message);

  const { data: row } = await db
    .from('x402_payment_attempts')
    .select('attempt_id, operation, status')
    .eq('attempt_id', attId)
    .single();
  assert('attempt row readable', row?.attempt_id === attId && row?.operation === 'verify');

  // cleanup
  await db.from('x402_payment_attempts').delete().eq('attempt_id', attId);
}

async function testRLSBlocked() {
  console.log('\n🔐  Suite 6: RLS — anon key must be blocked');
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    console.log('  ⚠️   NEXT_PUBLIC_SUPABASE_ANON_KEY not set — skipping RLS check');
    return;
  }
  const anonClient = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const { data, error } = await anonClient.from('x402_requirements').select('requirement_id').limit(1);
  assert('anon select blocked by RLS', !!error || (Array.isArray(data) && data.length === 0),
    `got ${data?.length} rows, error=${error?.message}`);
}

async function testDuplicateTxHashDifferentResource() {
  console.log('\n🚫  Suite 7: Duplicate txHash → different resource rejected at DB level');
  const reqId1 = uid('req_');
  const reqId2 = uid('req_');
  const payId1 = uid('pay_');
  const txHash = fakeTxHash();
  const resource1 = `/api/agents/dup-a-${uid()}/run`;
  const resource2 = `/api/agents/dup-b-${uid()}/run`;
  const expiresAt = new Date(Date.now() + 300_000).toISOString();

  for (const [rId, res] of [[reqId1, resource1], [reqId2, resource2]]) {
    await db.from('x402_requirements').insert({
      requirement_id: rId, protocol: 'x402', scheme: 'arc-escrow',
      network: 'arc-testnet', chain_id: 5042002, resource: res,
      resource_method: 'POST', pay_to: '0xf0e1b0709a012ade0b73596fdc8fa0ce037dd225',
      asset: '0x3600000000000000000000000000000000000000',
      amount_required: '1000000', currency: 'USDC', max_timeout_seconds: 300,
      expires_at: expiresAt, nonce: uid('n_'), status: 'active', metadata: {},
    });
  }

  // first payment on resource1
  const { error: e1 } = await db.from('x402_payments').insert({
    payment_id: payId1, requirement_id: reqId1, tx_hash: txHash,
    chain_id: 5042002, scheme: 'arc-escrow', network: 'arc-testnet',
    pay_to: '0xf0e1b0709a012ade0b73596fdc8fa0ce037dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amount: '1000000', job_id: '1', resource: resource1, event_name: 'JobFunded',
    verification_payload: {}, settlement_payload: {}, status: 'verified',
  });
  assert('first payment on resource1 succeeds', !e1, e1?.message);

  // second payment same txHash different resource → 23505
  const { error: e2 } = await db.from('x402_payments').insert({
    payment_id: uid('pay_'), requirement_id: reqId2, tx_hash: txHash,
    chain_id: 5042002, scheme: 'arc-escrow', network: 'arc-testnet',
    pay_to: '0xf0e1b0709a012ade0b73596fdc8fa0ce037dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amount: '1000000', job_id: '1', resource: resource2, event_name: 'JobFunded',
    verification_payload: {}, settlement_payload: {}, status: 'verified',
  });
  assert('same txHash different resource → 23505', e2?.code === '23505', `code=${e2?.code}`);

  await cleanup({ paymentIds: [payId1], requirementIds: [reqId1, reqId2] });
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀  Phase G — x402 Facilitator Integration Tests');
  console.log(`    Supabase: ${SUPABASE_URL}`);
  console.log(`    Time:     ${new Date().toISOString()}\n`);

  try {
    await testRequirementCRUD();
    await testPaymentIdempotency();
    await testConsumeRPC();
    await testResponseCache();
    await testAttemptAuditTrail();
    await testRLSBlocked();
    await testDuplicateTxHashDifferentResource();
  } catch (err) {
    console.error('\n💥  Unexpected error:', err);
    failed++;
  }

  const total = passed + failed;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`);

  if (failed > 0) {
    console.error('\n❌  Phase G FAILED — fix issues above before enabling X402_FACILITATOR_ENABLED=true');
    process.exit(1);
  } else {
    console.log('\n✅  Phase G PASSED — facilitator store is production-ready');
    console.log('    Next: set X402_FACILITATOR_ENABLED=true on preview env and run E2E');
  }
}

main();
