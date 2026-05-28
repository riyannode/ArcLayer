/**
 * PM2 Ecosystem Config — Circle Commerce Bots
 *
 * Each bot runs as a long-lived loop process (run-loop.sh).
 * No orchestrator, no pipeline — fully independent.
 *
 * Usage:
 *   pm2 start ecosystem.config.js              # start all
 *   pm2 start ecosystem.config.js --only oracle # start one
 *   pm2 restart ecosystem.config.js             # restart all
 *   pm2 stop ecosystem.config.js                # stop all
 *   pm2 delete ecosystem.config.js              # remove all
 *
 * Override interval: LOOP_INTERVAL=600 pm2 start ecosystem.config.js --only oracle
 */

module.exports = {
  apps: [
    {
      name: "commerce-oracle",
      script: "./run-loop.sh",
      args: "oracle",
      interpreter: "bash",
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,      // 5s between restarts (not tight loop)
      max_restarts: 100,        // stop after 100 crashes in a session
      min_uptime: 10000,        // must run 10s to count as "started"
      env: {
        LOOP_INTERVAL: 300,     // 5 min between runs
        NODE_ENV: "production",
      },
    },
    {
      name: "commerce-analyzer",
      script: "./run-loop.sh",
      args: "analyzer",
      interpreter: "bash",
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 100,
      min_uptime: 10000,
      env: {
        LOOP_INTERVAL: 300,
        NODE_ENV: "production",
      },
    },
    {
      name: "commerce-evaluator",
      script: "./run-loop.sh",
      args: "evaluator",
      interpreter: "bash",
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 100,
      min_uptime: 10000,
      env: {
        LOOP_INTERVAL: 300,
        NODE_ENV: "production",
      },
    },
    {
      name: "commerce-executor",
      script: "./run-loop.sh",
      args: "executor",
      interpreter: "bash",
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 100,
      min_uptime: 10000,
      env: {
        LOOP_INTERVAL: 300,
        NODE_ENV: "production",
      },
    },
  ],
};
