module.exports = {
  apps: [
    { name: 'arclayer-llm-analyzer', script: './analyzer-bot.js', env: { USE_LLM: 'true', LLM_BASE_URL: 'https://api.pioneer.ai/v1', LLM_MODEL: 'deepseek/deepseek-v4-pro' } },
    { name: 'arclayer-llm-evaluator', script: './evaluator-bot.js', env: { USE_LLM: 'true', LLM_BASE_URL: 'https://api.blockchain.info/ai/api/v1', LLM_MODEL: 'deepseek/deepseek-v4-pro' } },
    { name: 'arclayer-llm-executor', script: './executor-bot.js', env: { USE_LLM: 'true', LLM_BASE_URL: 'https://api.pioneer.ai/v1', LLM_MODEL: 'XiaomiMiMo/MiMo-V2.5-Pro' } },
    { name: 'arclayer-llm-oracle', script: './oracle-bot.js', env: { USE_LLM: 'true', LLM_BASE_URL: 'https://api.pioneer.ai/v1', LLM_MODEL: 'XiaomiMiMo/MiMo-V2.5-Pro' } }
  ]
};
