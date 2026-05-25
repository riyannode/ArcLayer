/**
 * ERC-8183 job client — HTTP client for /api/erc8183-jobs routes.
 *
 * Flow: createJob(on-chain) → setBudget(on-chain) → approve+fund(on-chain)
 *       → claim(off-chain metadata) → running(off-chain) → submit(on-chain)
 *       → complete(on-chain).
 *
 * Routes return tx instructions (address, functionName, args).
 * User signs + broadcasts via wallet; then posts tx hash to confirm.
 *
 * No private key handling. No server-side signing.
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

  /**
   * Step 1 — create local job, returns createJob tx instruction.
   * User signs + broadcasts createJob(provider, evaluator, expiredAt, desc, hook)
   * on AgenticCommerce contract, then POST /created with tx hash.
   */
  async createErc8183Job(input) {
    return request('/api/erc8183-jobs', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /**
   * Step 2 — confirm createJob tx, decode JobCreated, store erc8183_job_id.
   */
  async confirmCreateTx(localJobId, createTxHash) {
    return request(`/api/erc8183-jobs/${localJobId}/created`, {
      method: 'POST',
      body: JSON.stringify({ createTxHash }),
    });
  },

  /**
   * Step 3 — get setBudget tx instruction.
   * User signs setBudget(erc8183JobId, priceAtomic, "0x") on AgenticCommerce.
   * Then POST /tx with tx_hash=set_budget to confirm.
   */
  async setBudget(localJobId) {
    return request(`/api/erc8183-jobs/${localJobId}/set-budget`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  /**
   * Step 4 — get approve + fund tx instructions.
   * User signs approve(AgenticCommerce, amount) on USDC,
   * then fund(erc8183JobId, "0x") on AgenticCommerce.
   * Then POST /tx with tx_hash=fund to confirm.
   */
  async fund(localJobId) {
    return request(`/api/erc8183-jobs/${localJobId}/fund`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  /**
   * Confirm any tx on-chain (set_budget, approve, fund, submit, complete).
   * Reads receipt, verifies success, updates erc8183_status from getJob().
   */
  async confirmTx(localJobId, txType, txHash) {
    return request(`/api/erc8183-jobs/${localJobId}/tx`, {
      method: 'POST',
      body: JSON.stringify({ txType, txHash }),
    });
  },

  /**
   * Step 5 — off-chain worker metadata claim.
   * No smart contract call — on-chain escrow is already funded.
   * Allowed only when erc8183_status = Funded.
   */
  async claimErc8183Job(localJobId, { workerId, providerAgentId, claimTtlSeconds }) {
    return request(`/api/erc8183-jobs/${localJobId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ workerId, providerAgentId, claimTtlSeconds }),
    });
  },

  /**
   * Step 6 — off-chain running metadata.
   * No smart contract call.
   */
  async markErc8183Running(localJobId, workerId) {
    return request(`/api/erc8183-jobs/${localJobId}/running`, {
      method: 'POST',
      body: JSON.stringify({ workerId }),
    });
  },

  /**
   * Step 7 — compute deliverable hash, return submit tx instruction.
   * User signs submit(erc8183JobId, deliverableHash, "0x") on AgenticCommerce.
   * Then POST /tx with tx_hash=submit to confirm.
   */
  async submitErc8183Job(localJobId, { workerId, resultPayload, proofPayload }) {
    return request(`/api/erc8183-jobs/${localJobId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ workerId, resultPayload, proofPayload }),
    });
  },

  /**
   * Step 8 — complete escrow settlement.
   * Returns complete tx instruction.
   * User signs complete(erc8183JobId, reasonHash, "0x") on AgenticCommerce.
   * Then POST /tx with tx_hash=complete to confirm.
   *
   * MVP: approved=false returns unsupported_rejection_flow.
   */
  async completeErc8183Job(localJobId, { evaluatorAgentId, approved, reason }) {
    return request(`/api/erc8183-jobs/${localJobId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ evaluatorAgentId, approved, reason }),
    });
  },

  /**
   * Get job status (GET route).
   */
  async getErc8183Job(localJobId) {
    return request(`/api/erc8183-jobs/${localJobId}`);
  },
};
