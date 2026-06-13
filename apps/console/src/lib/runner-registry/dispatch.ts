/**
 * Dispatch helper: Console → Runner /runtime/run
 *
 * 1. Looks up runner from registry by agentId + role
 * 2. Signs request with HMAC
 * 3. POSTs to runner endpoint
 * 4. Logs dispatch to runner_dispatch_log
 * 5. Returns result with proof hash
 */
import { createHash, randomUUID } from 'node:crypto';
import { signDispatchRequest, HMAC_TIMESTAMP_HEADER, HMAC_NONCE_HEADER, HMAC_SIGNATURE_HEADER } from './hmac-signer';
import { findRunnerForTask, getRunnerSecret, insertDispatchLog, touchRunner } from './store';
import type { DispatchInput, DispatchResult } from './types';

const DISPATCH_TIMEOUT_MS = 30_000;

/**
 * Dispatch a task to a registered runner via HMAC-signed HTTP.
 *
 * @throws if no runner found, secret missing, or dispatch fails.
 */
export async function dispatchToRunner(input: DispatchInput): Promise<DispatchResult> {
  const role = input.role ?? 'provider';
  const dispatchId = `dispatch_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const startTime = Date.now();

  // 1. Find runner
  const runner = await findRunnerForTask(input.agentId, role);
  if (!runner) {
    throw new Error(`No active runner found for agent ${input.agentId} with role ${role}`);
  }

  // 2. Get HMAC secret
  const secret = await getRunnerSecret(runner.runner_id);
  if (!secret) {
    throw new Error(`No HMAC secret for runner ${runner.runner_id}`);
  }

  // 3. Build request
  const path = '/runtime/run';
  const body = JSON.stringify({
    taskId: input.taskId,
    protocol: input.protocol ?? 'generic',
    role,
    agentId: input.agentId,
    input: input.input,
    metadata: input.metadata ?? {},
  });
  const bodyHash = createHash('sha256').update(Buffer.from(body)).digest('hex');

  // 4. Sign
  const headers = signDispatchRequest({
    secret,
    method: 'POST',
    path,
    body,
  });

  // 5. Dispatch
  const url = `${runner.endpoint.replace(/\/+$/, '')}${path}`;
  let statusCode: number | null = null;
  let responseBody: Record<string, unknown> | null = null;
  let error: string | null = null;
  let proofSha256: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    statusCode = res.status;
    const text = await res.text();

    try {
      responseBody = JSON.parse(text) as Record<string, unknown>;
    } catch {
      responseBody = { raw: text };
    }

    if (res.ok && responseBody) {
      // Extract proof hash from runner response
      const result = responseBody.result as Record<string, unknown> | undefined;
      if (result) {
        const resultStr = JSON.stringify(result);
        proofSha256 = createHash('sha256').update(resultStr).digest('hex');
      }
    }

    // Touch runner last_seen
    await touchRunner(runner.runner_id);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    statusCode = 0;
  }

  const durationMs = Date.now() - startTime;

  // 6. Log dispatch
  await insertDispatchLog({
    dispatch_id: dispatchId,
    runner_id: runner.runner_id,
    agent_id: input.agentId,
    task_id: input.taskId,
    role,
    request_path: path,
    request_body_hash: `0x${bodyHash}`,
    hmac_nonce: headers[HMAC_NONCE_HEADER],
    hmac_timestamp: headers[HMAC_TIMESTAMP_HEADER],
    status_code: statusCode,
    response_body: responseBody,
    error,
    proof_sha256: proofSha256,
  }).catch((logErr) => {
    // Non-fatal: log but don't fail the dispatch
    console.error('[dispatch] Failed to log dispatch:', logErr);
  });

  if (error) {
    return {
      ok: false,
      dispatchId,
      runnerId: runner.runner_id,
      statusCode: statusCode ?? 0,
      result: { error },
      proofSha256: null,
      durationMs,
    };
  }

  return {
    ok: statusCode >= 200 && statusCode < 300,
    dispatchId,
    runnerId: runner.runner_id,
    statusCode: statusCode ?? 0,
    result: responseBody,
    proofSha256,
    durationMs,
  };
}
