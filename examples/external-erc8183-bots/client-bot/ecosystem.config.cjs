module.exports = {
  apps: [
    {
      name: 'arclayer-erc8183-client',
      script: './client-bot/index.js',
      cwd: '/root/ArcLayer/examples/external-erc8183-bots',
      env: {
        NODE_ENV: 'production',
      },
      env_file: './client-bot/.env',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './client-bot/logs/error.log',
      out_file: './client-bot/logs/output.log',
      merge_logs: true,
      time: true,
    },
  ],
};
