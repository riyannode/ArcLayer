module.exports = {
  apps: [
    {
      name: "executor-hi-freq",
      script: "run-buyer-hi-freq.js",
      interpreter: "node",
      cwd: __dirname,
      env: {
        BOT_CONFIG: "bot.config.executor.json",
        AGENT_ROLE: "executor",
        AGENT_CATEGORY: "prediction-market-bots",
        MARKET_ID: "btc-15m",
        ARCLAYER_AGENT_ID: "budu-executor",
        ARCLAYER_API_KEY: process.env.ARCLAYER_API_KEY_EXECUTOR || "",
        PRIVATE_KEY: process.env.BOT_PRIVATE_KEY_EXECUTOR || "",
        X402_PAYER_PRIVATE_KEY: process.env.BOT_PRIVATE_KEY_EXECUTOR || "",
        UPSTREAM_AGENT_ID: "ignia-evaluator",
        UPSTREAM_ROLE: "evaluator",
        RUNTIME_ID: "circle-commerce-executor-01",
        LLM_MODEL: "mock-llm",
        HI_FREQ_ENABLED: process.env.HI_FREQ_ENABLED || "false",
        STRESS_MODE: process.env.STRESS_MODE || "true",
        PAY_PER_MINUTE: process.env.PAY_PER_MINUTE || "9",
      },
      autorestart: true,
      max_memory_restart: "200M",
    },
  ],
};
