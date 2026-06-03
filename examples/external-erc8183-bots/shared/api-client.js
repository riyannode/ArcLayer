/**
 * ArcLayer API client — standalone HTTP wrapper.
 * Authorization: Bearer ***
 * Handles 401, 403, 409, 429, 5xx with retry.
 * Never logs secrets.
 */
const { log, error: logError } = require('./logger');

const TX_NOT_FOUND_RETRY_DELAY_MS = 5000;
const TX_NOT_FOUND_MAX_RETRIES = 3;

let _role = '';

function getBaseUrl() {
  return process.env.ARCLAYER_BASE_URL || 'https://arclayers.xyz';
}

/** Set the bot role for API key resolution. Call once at bot startup. */
function setRole(role) {
  _role = role;
  if (process.env.ARCLAYER_API_KEY) {
    console.warn('[api-client] WARNING: Deprecated API key env detected and ignored. Use PROVIDER_API_KEY for provider bots.');
  }
}

/** Resolve API key: role-specific env only. No shared-key fallback. */
function getApiKey() {
  if (_role === 'client') {
    return process.env.CLIENT_API_KEY || '';
  }
  if (_role === 'provider' || _role === 'worker') {
    return process.env.PROVIDER_API_KEY || '';
  }
  if (_role === 'evaluator') {
    return process.env.EVALUATOR_API_KEY || '';
  }
  return '';
}

async function request(path, method, body, retries = 0) {
  const url = `${getBaseUrl()}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  const key = getApiKey();
  if (key) headers['Authorization'] = `Bearer ${key}`;

  const res = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const json = await res.json().catch(() => ({ ok: false, error: 'invalid_json' }));

  // Handle tx_not_found with retry
  if (res.status === 409 && json.error === 'tx_not_found' && retries < TX_NOT_FOUND_MAX_RETRIES) {
    log('API', { retry: retries + 1, path, error: 'tx_not_found', delay: TX_NOT_FOUND_RETRY_DELAY_MS });
    await new Promise((r) => setTimeout(r, TX_NOT_FOUND_RETRY_DELAY_MS));
    return request(path, method, body, retries + 1);
  }

  // Handle rate limiting
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '10', 10);
    log('API', { retry: retries + 1, path, error: 'rate_limited', retryAfter });
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return request(path, method, body, retries + 1);
  }

  if (!res.ok) {
    const err = new Error(json.error || json.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return json;
}

module.exports = {
  /** Create local job, returns createJob tx instruction */
  async createJob(input) {
    return request('/api/erc8183-jobs', 'POST', input);
  },

  /** Confirm createJob tx, decode JobCreated event */
  async confirmCreateTx(localJobId, createTxHash) {
    return request(`/api/erc8183-jobs/${localJobId}/created`, 'POST', { createTxHash });
  },

  /** Get setBudget tx instruction */
  async setBudget(localJobId) {
    return request(`/api/erc8183-jobs/${localJobId}/set-budget`, 'POST', {});
  },

  /** Get approve + fund tx instructions */
  async fund(localJobId) {
    return request(`/api/erc8183-jobs/${localJobId}/fund`, 'POST', {});
  },

  /** Confirm any tx type (set_budget, approve, fund, submit, complete) */
  async confirmTx(localJobId, txType, txHash) {
    return request(`/api/erc8183-jobs/${localJobId}/tx`, 'POST', { txType, txHash });
  },

  /** Off-chain claim */
  async claim(localJobId, { workerId, providerAgentId, claimTtlSeconds }) {
    return request(`/api/erc8183-jobs/${localJobId}/claim`, 'POST', { workerId, providerAgentId, claimTtlSeconds });
  },

  /** Off-chain running */
  async markRunning(localJobId, workerId) {
    return request(`/api/erc8183-jobs/${localJobId}/running`, 'POST', { workerId });
  },

  /** Submit result, returns submit tx instruction */
  async submit(localJobId, { workerId, resultPayload, proofPayload }) {
    return request(`/api/erc8183-jobs/${localJobId}/submit`, 'POST', { workerId, resultPayload, proofPayload });
  },

  /** Complete escrow */
  async complete(localJobId, { evaluatorAgentId, approved, reason }) {
    return request(`/api/erc8183-jobs/${localJobId}/complete`, 'POST', { evaluatorAgentId, approved, reason });
  },

  /** GET job by localJobId — full detail including tx hashes and budget */
  async getJob(localJobId) {
    return request(`/api/erc8183-jobs/${localJobId}`, 'GET');
  },

  /** Reconcile local DB with on-chain state */
  async reconcile(localJobId) {
    return request(`/api/erc8183-jobs/${localJobId}/reconcile`, 'POST', {});
  },

  /** Poll for jobs — generic filter */
  async listJobs(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/erc8183-jobs${qs ? '?' + qs : ''}`, 'GET');
  },
};
