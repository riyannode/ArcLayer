module.exports = {
  apps: [
    { name: 'agora-oracle-bot', script: './oracle-bot.js', autorestart: false, watch: false },
    { name: 'agora-analyzer-bot', script: './analyzer-bot.js', autorestart: false, watch: false },
    { name: 'agora-evaluator-bot', script: './evaluator-bot.js', autorestart: false, watch: false },
    { name: 'agora-executor-bot', script: './executor-bot.js', autorestart: false, watch: false },
  ],
};
