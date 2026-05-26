module.exports = {
  apps: [
    {
      name: 'arclayer-erc8183-client',
      script: './index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      env_file: '.env',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/error.log',
      out_file: './logs/output.log',
      merge_logs: true,
      time: true,
    },
  ],
};
