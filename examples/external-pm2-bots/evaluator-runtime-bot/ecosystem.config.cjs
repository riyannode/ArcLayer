const agentId = process.env.EVALUATOR_ADDRESS || 'evaluator';

module.exports = {
  apps: [
    {
      name: `arclayer-evaluator-${agentId.slice(0, 10)}`,
      script: 'evaluator-bot.js',
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
