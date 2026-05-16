/**
 * ArcLayer A2A Agent Ecosystem — PM2 config.
 * Start all daemons: pm2 start ecosystem.config.cjs
 * Stop all:          pm2 stop ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: 'pythia',
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
      name: 'hermes-autonomous',
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
    {
      name: 'resolver',
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
