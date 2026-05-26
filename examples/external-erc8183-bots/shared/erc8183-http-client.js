/**
 * ERC-8183 HTTP client — wraps /api/erc8183-jobs routes.
 *
 * Each bot sends its own API key via Authorization header.
 * Routes return tx instructions (address, functionName, args).
 */
function getBaseUrl() {
  return process.env.ARCLAYER_BASE_URL || 'https://arclayers.xyz';
}

function getApiKey() {
  return process.env.ARCLAYER_API_KEY || '';
}

async function request(path, method, body) {
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
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

module.exports = {
  /** Step 1 — create local job, returns createJob tx instruction */
  async createJob(input) {
    return request('/api/erc8183-jobs', 'POST', input);
  },

  /** Step 2 — confirm createJob tx, decode JobCreated */
  async confirmCreateTx(localJobId, createTxHash) {
    return request(`/api/erc8183-jobs/${localJobId}/created`, 'POST', { createTxHash });
  },

  /** Step 3 — get setBudget tx instruction */
  async setBudget(localJobId) {
    return request(`/api/erc8183-jobs/${localJobId}/set-budget`, 'POST', {});
  },

  /** Step 4 — get approve + fund tx instructions */
  async fund(localJobId) {
    return request(`/api/erc8183-jobs/${localJobId}/fund`, 'POST', {});
  },

  /** Confirm any tx type (set_budget, approve, fund, submit, complete) */
  async confirmTx(localJobId, txType, txHash) {
    return request(`/api/erc8183-jobs/${localJobId}/tx`, 'POST', { txType, txHash });
  },

  /** Step 5 — off-chain claim */
  async claim(localJobId, { workerId, providerAgentId, claimTtlSeconds }) {
    return request(`/api/erc8183-jobs/${localJobId}/claim`, 'POST', { workerId, providerAgentId, claimTtlSeconds });
  },

  /** Step 6 — off-chain running */
  async markRunning(localJobId, workerId) {
    return request(`/api/erc8183-jobs/${localJobId}/running`, 'POST', { workerId });
  },

  /** Step 7 — submit result, returns submit tx instruction */
  async submit(localJobId, { workerId, resultPayload, proofPayload }) {
    return request(`/api/erc8183-jobs/${localJobId}/submit`, 'POST', { workerId, resultPayload, proofPayload });
  },

  /** Step 8 — complete escrow */
  async complete(localJobId, { evaluatorAgentId, approved, reason }) {
    return request(`/api/erc8183-jobs/${localJobId}/complete`, 'POST', { evaluatorAgentId, approved, reason });
  },

  /** GET job by localJobId */
  async getJob(localJobId) {
    return request(`/api/erc8183-jobs/${localJobId}`, 'GET');
  },

  /** Poll for jobs — generic filter */
  async listJobs(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/erc8183-jobs${qs ? '?' + qs : ''}`, 'GET');
  },
};
