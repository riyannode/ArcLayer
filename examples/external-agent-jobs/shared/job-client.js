/**
 * Shared job client — base HTTP client for agent jobs API.
 */

const BASE_URL = process.env.ARCLAYER_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.ARCLAYER_API_KEY || '';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      ...options.headers,
    },
    ...options,
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
  BASE_URL,
  API_KEY,

  async createJob({ jobType, buyerAgentId, inputPayload, priceAtomic, marketId, deadlineAt, metadata }) {
    return request('/api/agent-jobs', {
      method: 'POST',
      body: JSON.stringify({ jobType, buyerAgentId, inputPayload, priceAtomic, marketId, deadlineAt, metadata }),
    });
  },

  async listJobs(filters = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.jobType) params.set('jobType', filters.jobType);
    if (filters.marketId) params.set('marketId', filters.marketId);
    if (filters.buyerAgentId) params.set('buyerAgentId', filters.buyerAgentId);
    if (filters.workerId) params.set('workerId', filters.workerId);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return request(`/api/agent-jobs${qs ? `?${qs}` : ''}`);
  },

  async getJob(jobId) {
    return request(`/api/agent-jobs/${jobId}`);
  },

  async claimJob({ jobType, workerId, providerAgentId, claimTtlSeconds }) {
    return request('/api/agent-jobs/claim', {
      method: 'POST',
      body: JSON.stringify({ jobType, workerId, providerAgentId, claimTtlSeconds }),
    });
  },

  async markRunning({ jobId, workerId }) {
    return request(`/api/agent-jobs/${jobId}/running`, {
      method: 'POST',
      body: JSON.stringify({ workerId }),
    });
  },

  async submitJob({ jobId, workerId, resultPayload, proofPayload }) {
    return request(`/api/agent-jobs/${jobId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ workerId, resultPayload, proofPayload }),
    });
  },

  async verifyJob({ jobId, verifierAgentId, approved, reason, metadata }) {
    return request(`/api/agent-jobs/${jobId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ verifierAgentId, approved, reason, metadata }),
    });
  },

  async settleJob({ jobId, buyerAgentId, paymentProof }) {
    // settle uses x402 — requires payment header
    const headers = {};
    if (paymentProof) {
      headers['X-PAYMENT'] = typeof paymentProof === 'string' ? paymentProof : JSON.stringify(paymentProof);
    }
    return request(`/api/agent-jobs/${jobId}/settle`, {
      method: 'POST',
      body: JSON.stringify({
        buyerAgentId,
        sessionId: `job:${jobId}`,
        scope: 'job_settlement',
        role: 'buyer',
      }),
      headers,
    });
  },
};
