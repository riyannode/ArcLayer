#!/usr/bin/env node
/**
 * MCP Signing Bridge — Smoke Test.
 *
 * Env-gated: requires ARCLAYER_TEST_BASE_URL.
 * Safely skippable: exits 0 if env missing.
 * Read-only default: no mutations unless ARCLAYER_TEST_ALLOW_MUTATION=1.
 *
 * Flow:
 * 1. Start profile session (POST /api/mcp/signing-sessions)
 * 2. Create request WITHOUT ARCLAYER_CLIENT_WALLET (should derive from session)
 * 3. Poll pending requests
 * 4. Verify invalid transition returns 409 (not ok:true)
 * 5. Cancel request (cleanup)
 */

const BASE_URL = process.env.ARCLAYER_TEST_BASE_URL;

if (!BASE_URL) {
  console.log('skipped: ARCLAYER_TEST_BASE_URL not set');
  process.exit(0);
}

const ALLOW_MUTATION = process.env.ARCLAYER_TEST_ALLOW_MUTATION === '1';

async function main() {
  console.log(`[smoke] base URL: ${BASE_URL}`);
  console.log(`[smoke] mutation: ${ALLOW_MUTATION ? 'enabled' : 'read-only'}`);

  // ── 1. Create session (requires wallet cookie — skip if no mutation) ────

  if (!ALLOW_MUTATION) {
    console.log('[smoke] skipped: mutation mode not enabled (set ARCLAYER_TEST_ALLOW_MUTATION=1)');
    console.log('[smoke] manual test checklist:');
    console.log('  1. Open /profile, connect wallet, click "Start MCP Signing Session"');
    console.log('  2. Copy sessionId from the card');
    console.log('  3. POST /api/mcp/signing-requests with sessionId but NO expectedClientWallet');
    console.log('  4. Verify request is created with session.owner_wallet as expectedClientWallet');
    console.log('  5. Poll /api/mcp/signing-requests/pending?sessionId=...');
    console.log('  6. Close modal — verify it does NOT reopen for same requestId');
    console.log('  7. POST /api/mcp/signing-requests/[id]/submitted on a pending request → expect 409');
    console.log('  8. POST /api/mcp/signing-requests/[id]/cancel → expect ok:true');
    console.log('  9. POST /api/mcp/signing-requests/[id]/cancel again → expect 409');
    process.exit(0);
  }

  // ── Mutation mode: full flow ───────────────────────────────────────────

  let sessionId = '';
  let requestId = '';

  try {
    // 1. Create session
    console.log('\n[1] Creating session...');
    const sessionRes = await fetch(`${BASE_URL}/api/mcp/signing-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const sessionData = await sessionRes.json();
    if (!sessionData.ok) {
      console.error('[1] FAIL:', sessionData);
      process.exit(1);
    }
    sessionId = sessionData.session.id;
    console.log(`[1] OK: session=${sessionId}, pairing=${sessionData.session.pairingCode}`);

    // 2. Create request WITHOUT expectedClientWallet
    console.log('\n[2] Creating request (no expectedClientWallet)...');
    const requestRes = await fetch(`${BASE_URL}/api/mcp/signing-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        actionType: 'create_job',
        chainId: 5042002,
        // expectedClientWallet omitted — should derive from session
        transactions: [
          {
            kind: 'erc8183_create_job',
            to: '0x0747EEf0706327138c69792bF28Cd525089e4583',
            data: '0x41528812' + '0'.repeat(64 * 5), // dummy createJob calldata
            value: '0',
            summary: 'Test create job',
          },
        ],
      }),
    });
    const requestData = await requestRes.json();
    if (!requestData.ok) {
      console.error('[2] FAIL:', requestData);
      process.exit(1);
    }
    requestId = requestData.request.id;
    console.log(`[2] OK: request=${requestId}, status=${requestData.request.status}`);

    // 3. Poll pending
    console.log('\n[3] Polling pending...');
    const pendingRes = await fetch(
      `${BASE_URL}/api/mcp/signing-requests/pending?sessionId=${sessionId}`,
    );
    const pendingData = await pendingRes.json();
    if (!pendingData.ok) {
      console.error('[3] FAIL:', pendingData);
      process.exit(1);
    }
    const found = pendingData.requests.find((r: { id: string }) => r.id === requestId);
    if (!found) {
      console.error('[3] FAIL: request not found in pending list');
      process.exit(1);
    }
    console.log(`[3] OK: ${pendingData.requests.length} pending, found our request`);

    // 4. Invalid transition: submitted on pending → expect 409
    console.log('\n[4] Testing invalid transition (submitted on pending)...');
    const invalidRes = await fetch(`${BASE_URL}/api/mcp/signing-requests/${requestId}/submitted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash: '0x' + 'a'.repeat(64) }),
    });
    if (invalidRes.status === 409) {
      console.log('[4] OK: got 409 as expected');
    } else {
      const invalidData = await invalidRes.json();
      console.error('[4] FAIL: expected 409, got', invalidRes.status, invalidData);
      process.exit(1);
    }

    // 5. Cancel
    console.log('\n[5] Cancelling request...');
    const cancelRes = await fetch(`${BASE_URL}/api/mcp/signing-requests/${requestId}/cancel`, {
      method: 'POST',
    });
    const cancelData = await cancelRes.json();
    if (!cancelData.ok) {
      console.error('[5] FAIL:', cancelData);
      process.exit(1);
    }
    console.log('[5] OK: cancelled');

    // 6. Double cancel → expect 409
    console.log('\n[6] Testing double cancel...');
    const doubleCancelRes = await fetch(
      `${BASE_URL}/api/mcp/signing-requests/${requestId}/cancel`,
      { method: 'POST' },
    );
    if (doubleCancelRes.status === 409) {
      console.log('[6] OK: got 409 as expected');
    } else {
      const doubleData = await doubleCancelRes.json();
      console.error('[6] FAIL: expected 409, got', doubleCancelRes.status, doubleData);
      process.exit(1);
    }

    // 7. Revoke session
    console.log('\n[7] Revoking session...');
    const revokeRes = await fetch(`${BASE_URL}/api/mcp/signing-sessions/${sessionId}/revoke`, {
      method: 'POST',
    });
    const revokeData = await revokeRes.json();
    if (!revokeData.ok) {
      console.error('[7] FAIL:', revokeData);
      process.exit(1);
    }
    console.log('[7] OK: session revoked');

    console.log('\n[smoke] ALL PASSED ✅');
  } catch (err) {
    console.error('[smoke] ERROR:', err);
    process.exit(1);
  }
}

main();
