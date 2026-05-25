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
    }
  ]
};
