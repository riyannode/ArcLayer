module.exports = {
  apps: [
    {
      name: "oracle-bot",
      script: "./oracle-bot.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        BOT_ROLE: "oracle",
        BOT_ENV_FILE: ".env.oracle",
        COMMON_ENV_FILE: ".env.common",
        RUN_FOREVER: "true"
      }
    },
    {
      name: "analyzer-bot",
      script: "./analyzer-bot.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        BOT_ROLE: "analyzer",
        BOT_ENV_FILE: ".env.analyzer",
        COMMON_ENV_FILE: ".env.common",
        RUN_FOREVER: "true"
      }
    },
    {
      name: "evaluator-bot",
      script: "./evaluator-bot.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        BOT_ROLE: "evaluator",
        BOT_ENV_FILE: ".env.evaluator",
        COMMON_ENV_FILE: ".env.common",
        RUN_FOREVER: "true"
      }
    },
    {
      name: "executor-bot",
      script: "./executor-bot.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        BOT_ROLE: "executor",
        BOT_ENV_FILE: ".env.executor",
        COMMON_ENV_FILE: ".env.common",
        RUN_FOREVER: "true"
      }
    },
    {
      // Standalone presence reporter — posts "online" heartbeat to the dashboard.
      // Each bot runs independently with its own API key in .env.<role>.
      // This process only handles presence/heartbeat visibility.
      name: "prediction-market-heartbeat",
      script: "../prediction-market-heartbeat.mjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        // Auth for heartbeat only (not the bots themselves).
        //
        // Option A: Per-agent keys (recommended for multi-agent setups)
        //   PREDICTION_AGENT_IDS="<your-oracle-id>:My Oracle,<your-analyzer-id>:My Analyzer,..."
        //   PREDICTION_AGENT_KEYS="<your-oracle-id>:ak_xxx,<your-analyzer-id>:ak_xxx,..."
        //
        // Option B: Single global token (simpler, one key covers all agents)
        //   A2A_LIVE_EVENTS_TOKEN=ak_xxx
        //
        // Generate keys via: POST /api/a2a/keys { scopes: ["agent_bridge:write", "agent_bridge:receipt", "live_events:write", "presence:write"] }
        PREDICTION_AGENT_IDS: process.env.PREDICTION_AGENT_IDS || "",
        PREDICTION_AGENT_KEYS: process.env.PREDICTION_AGENT_KEYS || "",
        A2A_LIVE_EVENTS_TOKEN: process.env.A2A_LIVE_EVENTS_TOKEN || "",
        ARCLAYER_WEB_ORIGIN: process.env.ARCLAYER_WEB_ORIGIN || "https://arclayers.xyz"
      }
    }
  ]
};
