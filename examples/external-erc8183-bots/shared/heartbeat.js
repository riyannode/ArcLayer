/**
 * Shared heartbeat module for ERC-8183 bots.
 *
 * POSTs presence to /api/a2a/presence every 30–60 seconds.
 * Uses role-specific API key in Authorization header.
 * Never sends secrets in body. Logs warning on failure, never crashes.
 */

const https = require('https');
const http = require('http');

const VERSION = '0.1.0';
const HEARTBEAT_INTERVAL_MS = 45_000; // 45s — between 30-60s range
const HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * Start heartbeat loop. Returns a stop function.
 *
 * @param {Object} opts
 * @param {string} opts.agentId - ERC-8004 agent ID
 * @param {string} opts.role - "client" | "provider" | "evaluator"
 * @param {string} opts.apiKey - Role-specific API key (ak_...)
 * @param {string} opts.baseUrl - ArcLayer base URL (https://arclayers.xyz)
 * @param {string} opts.processName - PM2 process name (e.g. "arclayer-erc8183-provider")
 * @param {number} [opts.chainId=5042002] - Arc chain ID
 * @param {function} [opts.rpcCheck] - Optional async function returning boolean for rpcOk
 */
function startHeartbeat(opts) {
  const {
    agentId,
    role,
    apiKey,
    baseUrl,
    processName,
    chainId = 5042002,
    rpcCheck,
  } = opts;

  if (!agentId || !role || !apiKey || !baseUrl || !processName) {
    console.warn('[heartbeat] Missing required params — heartbeat disabled');
    return () => {};
  }

  let running = true;
  let consecutiveFailures = 0;

  async function sendHeartbeat() {
    if (!running) return;

    let rpcOk = true;
    if (typeof rpcCheck === 'function') {
      try {
        rpcOk = await rpcCheck();
      } catch {
        rpcOk = false;
      }
    }

    const body = JSON.stringify({
      agentId,
      role,
      runtimeType: 'erc8183-bot',
      processName,
      status: 'running',
      version: VERSION,
      chainId,
      rpcOk,
    });

    try {
      const url = new URL('/api/a2a/presence', baseUrl);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      await new Promise((resolve, reject) => {
        const req = transport.request(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            timeout: HEARTBEAT_TIMEOUT_MS,
          },
          (res) => {
            // Drain response
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                consecutiveFailures = 0;
                resolve();
              } else {
                // Log status + truncated error body (no secrets)
                const errPreview = data.slice(0, 120);
                reject(new Error(`HTTP ${res.statusCode}: ${errPreview}`));
              }
            });
          },
        );

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('timeout'));
        });

        req.write(body);
        req.end();
      });
    } catch (err) {
      consecutiveFailures++;
      // Log concise warning — never crash
      if (consecutiveFailures <= 3 || consecutiveFailures % 10 === 0) {
        console.warn(`[heartbeat] Failed (x${consecutiveFailures}): ${err.message}`);
      }
    }
  }

  // First heartbeat after 5s delay (let bot initialize)
  const startupTimer = setTimeout(() => {
    sendHeartbeat();
    // Then repeat every interval
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    // Store for cleanup
    heartbeat._interval = interval;
  }, 5_000);

  const heartbeat = {
    _startupTimer: startupTimer,
    _interval: null,
    stop() {
      running = false;
      clearTimeout(heartbeat._startupTimer);
      if (heartbeat._interval) clearInterval(heartbeat._interval);
    },
  };

  return heartbeat.stop.bind(heartbeat);
}

module.exports = { startHeartbeat };
