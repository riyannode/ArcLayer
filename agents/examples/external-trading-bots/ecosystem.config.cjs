module.exports = {
  apps: [
    { name: 'oracle-bot', script: './bot.js', env_file: '.env.oracle', env: { BOT_ROLE: 'oracle' } },
    { name: 'momentum-resolver-bot', script: './bot.js', env_file: '.env.momentum', env: { BOT_ROLE: 'momentum_resolver' } },
    { name: 'scalping-resolver-bot', script: './bot.js', env_file: '.env.scalping', env: { BOT_ROLE: 'scalping_resolver' } },
    { name: 'evaluator-bot', script: './bot.js', env_file: '.env.evaluator', env: { BOT_ROLE: 'evaluator' } },
    { name: 'executor-bot', script: './bot.js', env_file: '.env.executor', env: { BOT_ROLE: 'executor', DRY_RUN: 'true' } },
  ],
};
