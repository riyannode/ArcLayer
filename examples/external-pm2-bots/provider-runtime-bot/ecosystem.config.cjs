module.exports = {
  apps: [
    {
      name: 'arclayer-provider-runtime',
      script: 'provider-bot.js',
      cwd: __dirname,
      interpreter: 'node',
      max_restarts: 10,
      restart_delay: 5000,
      autorestart: true,
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
