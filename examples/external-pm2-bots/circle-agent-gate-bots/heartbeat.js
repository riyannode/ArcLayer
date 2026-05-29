#!/usr/bin/env node
// Independent heartbeat per bot — runs every 60s
// Usage: node heartbeat.js bot.config.oracle.json

const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: node heartbeat.js <bot.config.*.json>");
  process.exit(1);
}

const fullPath = path.isAbsolute(configPath) ? configPath : path.join(__dirname, configPath);
if (!fs.existsSync(fullPath)) {
  console.error(`Config not found: ${fullPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(fullPath, "utf8"));
const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/+$/, "");
const agentId = config.agentId;
const apiKey = config.apiKey;
const role = config.role;
const INTERVAL_MS = 60_000; // 1 minute

async function beat() {
  try {
    const res = await fetch(`${BASE_URL}/api/a2a/presence`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId,
        agentName: agentId,
        status: "online",
        lastEventType: "heartbeat",
        lastEventSummary: `${role} heartbeat`,
      }),
    });
    if (!res.ok) {
      console.error(`[${agentId}] heartbeat ${res.status}`);
    } else {
      const now = new Date().toISOString().slice(11, 19);
      console.log(`[${now}] ${agentId} ♥`);
    }
  } catch (err) {
    console.error(`[${agentId}] heartbeat error: ${err.message}`);
  }
}

// First beat immediately, then every 60s
beat();
setInterval(beat, INTERVAL_MS);
