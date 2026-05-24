const path = require("node:path");
const fs = require("node:fs");
const dotenv = require("dotenv");

const RUNTIME_ENV_KEYS = [
  "EVENT_CHAIN_ENABLED",
  "RUN_FOREVER",
  "STARTUP_DELAY_MS",
  "BOT_ENV_FILE",
  "COMMON_ENV_FILE",
  "BOT_ROLE"
];

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
  const parsed = dotenv.parse(fs.readFileSync(file));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }
  return true;
}

function restoreRuntimeEnv(snapshot) {
  for (const key of RUNTIME_ENV_KEYS) {
    if (snapshot[key] !== undefined) {
      process.env[key] = snapshot[key];
    }
  }
}

function loadRoleEnv(role) {
  const root = path.resolve(__dirname, "..");
  const runtimeSnapshot = {};
  for (const key of RUNTIME_ENV_KEYS) {
    if (process.env[key] !== undefined) runtimeSnapshot[key] = process.env[key];
  }

  const commonFile = process.env.COMMON_ENV_FILE
    ? path.resolve(root, process.env.COMMON_ENV_FILE)
    : path.resolve(root, ".env.common");

  const roleFile = process.env.BOT_ENV_FILE
    ? path.resolve(root, process.env.BOT_ENV_FILE)
    : path.resolve(root, `.env.${role}`);

  const loadedCommon = loadEnvFile(commonFile);
  const loadedRole = loadEnvFile(roleFile);

  if (process.env.LEGACY_SHARED_ENV === "true") {
    loadEnvFile(path.resolve(root, ".env"));
  }

  restoreRuntimeEnv(runtimeSnapshot);

  process.env.BOT_ROLE = process.env.BOT_ROLE || role;

  return {
    role,
    commonFile,
    roleFile,
    loadedCommon,
    loadedRole
  };
}

function requireEnv(keys) {
  const missing = keys.filter((key) => {
    const value = process.env[key];
    return !value || value === "..." || value.includes("ISI_");
  });

  if (missing.length > 0) {
    throw new Error(`missing_env:${missing.join(",")}`);
  }
}

module.exports = {
  loadRoleEnv,
  requireEnv
};
