module.exports = {
  apps: [
    // ─── Stress Test: x402 payments every 1s ───
    {
      name: "stress-x402-analyzer",
      script: "stress-x402.js",
      interpreter: "node",
      env: {
        AGENT_ROLE: "analyzer",
        UPSTREAM_AGENT_ID: process.env.UPSTREAM_AGENT_ID || "REPLACE_ME",
        UPSTREAM_ROLE: "oracle",
        MARKET_ID: "btc-15m",
        PAY_INTERVAL: "1000",  // 1 second
        MAX_PAYMENTS: "0",     // infinite
        HI_FREQ_ENABLED: process.env.HI_FREQ_ENABLED || "false",
        STRESS_MODE: process.env.STRESS_MODE || "true",
        PAY_PER_MINUTE: process.env.PAY_PER_MINUTE || "9",
      },
      autorestart: false,
      max_memory_restart: "100M",
    },
    {
      name: "stress-x402-evaluator",
      script: "stress-x402.js",
      interpreter: "node",
      env: {
        AGENT_ROLE: "evaluator",
        UPSTREAM_AGENT_ID: process.env.UPSTREAM_AGENT_ID || "REPLACE_ME",
        UPSTREAM_ROLE: "analyzer",
        MARKET_ID: "btc-15m",
        PAY_INTERVAL: "1000",
        MAX_PAYMENTS: "0",
        HI_FREQ_ENABLED: process.env.HI_FREQ_ENABLED || "false",
        STRESS_MODE: process.env.STRESS_MODE || "true",
        PAY_PER_MINUTE: process.env.PAY_PER_MINUTE || "9",
      },
      autorestart: false,
      max_memory_restart: "100M",
    },
    {
      name: "stress-x402-executor",
      script: "stress-x402.js",
      interpreter: "node",
      env: {
        AGENT_ROLE: "executor",
        UPSTREAM_AGENT_ID: process.env.UPSTREAM_AGENT_ID || "REPLACE_ME",
        UPSTREAM_ROLE: "evaluator",
        MARKET_ID: "btc-15m",
        PAY_INTERVAL: "1000",
        MAX_PAYMENTS: "0",
        HI_FREQ_ENABLED: process.env.HI_FREQ_ENABLED || "false",
        STRESS_MODE: process.env.STRESS_MODE || "true",
        PAY_PER_MINUTE: process.env.PAY_PER_MINUTE || "9",
      },
      autorestart: false,
      max_memory_restart: "100M",
    },
  ],
};
