/**
 * PM2 Ecosystem Config — Circle Commerce Bots (Production)
 *
 * Each bot runs as a long-lived loop process (run-loop.sh).
 * Each heartbeat runs as an independent 60s interval process (heartbeat.js).
 * No orchestrator, no pipeline — fully independent.
 *
 * Usage:
 *   cd examples/external-pm2-bots/circle-agent-gate-bots
 *   pm2 start pm2/ecosystem.config.js              # start all
 *   pm2 start pm2/ecosystem.config.js --only oracle # start one
 *   pm2 restart pm2/ecosystem.config.js             # restart all
 *   pm2 stop pm2/ecosystem.config.js                # stop all
 *   pm2 delete pm2/ecosystem.config.js              # remove all
 *
 * Override interval: LOOP_INTERVAL=600 pm2 start pm2/ecosystem.config.js --only oracle
 *
 * For ArcLayer demo presets, see presets/arc-demo/ecosystem.config.js
 */

const path = require("node:path");
const CWD = path.resolve(__dirname, "..");

module.exports = {
  apps: [
    // ── Bots (cycle every 5min) ───────────────────────────────────
    {
      name: "commerce-oracle",
      script: "./run-loop.sh",
      args: "oracle",
      interpreter: "bash",
      cwd: CWD,
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
      name: "commerce-analyzer",
      script: "./run-loop.sh",
      args: "analyzer",
      interpreter: "bash",
      cwd: CWD,
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
      cwd: CWD,
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
      cwd: CWD,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 100,
      min_uptime: 10000,
      env: {
        LOOP_INTERVAL: 300,
        NODE_ENV: "production",
      },
    },

    // ── Heartbeats (every 60s, independent per bot) ───────────────
    {
      name: "heartbeat-oracle",
      script: "./heartbeat.js",
      args: "bot.config.oracle.json",
      interpreter: "node",
      cwd: CWD,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 999,
      min_uptime: 3000,
      env: { NODE_ENV: "production" },
    },
    {
      name: "heartbeat-analyzer",
      script: "./heartbeat.js",
      args: "bot.config.analyzer.json",
      interpreter: "node",
      cwd: CWD,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 999,
      min_uptime: 3000,
      env: { NODE_ENV: "production" },
    },
    {
      name: "heartbeat-evaluator",
      script: "./heartbeat.js",
      args: "bot.config.evaluator.json",
      interpreter: "node",
      cwd: CWD,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 999,
      min_uptime: 3000,
      env: { NODE_ENV: "production" },
    },
    {
      name: "heartbeat-executor",
      script: "./heartbeat.js",
      args: "bot.config.executor.json",
      interpreter: "node",
      cwd: CWD,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 999,
      min_uptime: 3000,
      env: { NODE_ENV: "production" },
    },
  ],
};
