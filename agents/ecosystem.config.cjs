/**
 * ArcLayer A2A Agent Ecosystem — PM2 config.
 *
 * 3 core agents:
 *   - Ignia (Oracle)    → internal raw signal server :4011
 *   - Apolo (Resolver)  → paid x402 decision endpoint :4012
 *   - Hermes (Trader)   → autonomous buyer + paper trader
 *
 * Supporting daemons:
 *   - Pythia (legacy x402 signal server :4001)
 *   - Scanner (Polymarket → Ignia mirror)
 *   - Resolver daemon (on-chain settlement watcher)
 *
 * Start all: pm2 start ecosystem.config.cjs
 * Stop all:  pm2 stop ecosystem.config.cjs
 */
module.exports = {
  apps: [
    // ─── Core A2A Agents ────────────────────────────────────────────
    {
      name: 'ignia-oracle',
      script: 'npm',
      args: 'run pythia:oracle',
      cwd: '/root/ArcLayer/agents',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '200M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'apolo-resolver',
      script: 'npm',
      args: 'run resolver:paid',
      cwd: '/root/ArcLayer/agents',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '200M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'hermes-trader',
      script: 'npm',
      args: 'run hermes',
      cwd: '/root/ArcLayer/agents',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '200M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        NODE_ENV: 'production',
      },
    },
    // ─── Supporting Daemons ─────────────────────────────────────────
    {
      name: 'pythia-legacy',
      script: 'npm',
      args: 'run pythia',
      cwd: '/root/ArcLayer/agents',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '200M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'resolver-daemon',
      script: 'npm',
      args: 'run resolver',
      cwd: '/root/ArcLayer/agents',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
      max_memory_restart: '150M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'scanner',
      script: 'npm',
      args: 'run scanner',
      cwd: '/root/ArcLayer/agents',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
      max_memory_restart: '150M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        NODE_ENV: 'production',
        SCANNER_INTERVAL_MS: '30000',
        SCANNER_MAX_PER_TICK: '3',
        SCANNER_ASSETS: 'BTC,ETH,SOL',
      },
    },
  ],
};
