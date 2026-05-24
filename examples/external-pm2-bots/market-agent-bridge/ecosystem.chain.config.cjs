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
        EVENT_CHAIN_ENABLED: "true",
        RUN_FOREVER: "true"
      }
    }
  ]
};
