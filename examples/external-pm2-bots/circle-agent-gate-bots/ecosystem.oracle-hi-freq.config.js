module.exports = {
  apps: [
    {
      name: "oracle-hi-freq",
      script: "run-oracle-hi-freq.js",
      interpreter: "node",
      cwd: __dirname,
      env: {
        BOT_CONFIG: "bot.config.oracle.json",
        AGENT_ROLE: "oracle",
        MARKET_ID: "btc-15m",
        ARCLAYER_AGENT_ID: "hermes-oracle",
        ARCLAYER_API_KEY: process.env.ARCLAYER_API_KEY_ORACLE || "",
        PRIVATE_KEY: process.env.BOT_PRIVATE_KEY_ORACLE || "",
        X402_PAYER_PRIVATE_KEY: process.env.BOT_PRIVATE_KEY_ORACLE || "",
        LLM_MODEL: process.env.LLM_MODEL || "xiaomi/mimo-v2-flash",
      },
      autorestart: true,
      max_memory_restart: "200M",
    },
  ],
};
