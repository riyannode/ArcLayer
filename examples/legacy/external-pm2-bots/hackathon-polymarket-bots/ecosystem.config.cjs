module.exports = {
  apps: [
    { name: 'arclayer-pm2-oracle-bot', script: './oracle-bot.js', autorestart: false, watch: false },
    { name: 'arclayer-pm2-analyzer-bot', script: './analyzer-bot.js', autorestart: false, watch: false },
    { name: 'arclayer-pm2-evaluator-bot', script: './evaluator-bot.js', autorestart: false, watch: false },
    { name: 'arclayer-pm2-executor-bot', script: './executor-bot.js', autorestart: false, watch: false },
  ],
};
