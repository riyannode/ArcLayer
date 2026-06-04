/**
 * ERC-8183 HTTP client — wraps /api/erc8183-jobs routes.
 *
 * Each bot sends its own API key via Authorization header.
 * Routes return tx instructions (address, functionName, args).
 *
 * Role-aware API key resolution:
 *   client    → CLIENT_API_KEY
 *   provider  → PROVIDER_API_KEY
 *   evaluator → EVALUATOR_API_KEY
 */

let _role = '';

function getBaseUrl() {
  return process.env.ARCLAYER_BASE_URL || 'https://arclayers.xyz';
}

/** Set the bot role for API key resolution. Call once at bot startup. */
function setRole(role) {
  _role = role;
}

/** Resolve API key: role-specific env only. No ARCLAYER_API_KEY fallback. */
function getApiKey() {
  if (_role === 'client') {
    return process.env.CLIENT_API_KEY || '';
  }
  if (_role === 'provider') {
    return process.env.PROVIDER_API_KEY || '';
  }
  if (_role === 'evaluator') {
    return process.env.EVALUATOR_API_KEY || '';
  }
  return '';
}

/** Get the expected env var name for the current role (for error messages). */
function getExpectedKeyEnv() {
  if (_role === 'client') return 'CLIENT_API_KEY';
  if (_role === 'provider') return 'PROVIDER_API_KEY';
  if (_role === 'evaluator') return 'EVALUATOR_API_KEY';
  return 'CLIENT_API_KEY';
}

async function request(path, method, body) {
  const url = `${getBaseUrl()}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  const key = getApiKey();
  if (!key) {
    throw new Error(`Missing ${getExpectedKeyEnv()} — set the correct API key in .env`);
  }
  headers['Authorization'] = `Bearer ${key}`;

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
  /** Set bot role for API key resolution. Call once at startup. */
  setRole,

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
  async claim(localJobId, { providerAgentId, claimTtlSeconds }) {
    return request(`/api/erc8183-jobs/${localJobId}/claim`, 'POST', { providerAgentId, claimTtlSeconds });
  },

  /** Step 6 — off-chain running */
  async markRunning(localJobId, providerAgentId) {
    return request(`/api/erc8183-jobs/${localJobId}/running`, 'POST', { providerAgentId });
  },

  /** Step 7 — submit result, returns submit tx instruction */
  async submit(localJobId, { providerAgentId, resultPayload, proofPayload }) {
    return request(`/api/erc8183-jobs/${localJobId}/submit`, 'POST', { providerAgentId, resultPayload, proofPayload });
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
