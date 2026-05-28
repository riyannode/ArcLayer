const crypto = require("node:crypto");

function sha256(value) {
  return `0x${crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex")}`;
}

function currentSessionId(prefix = "circle") {
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000)) * 15 * 60;
  return `${prefix}_${bucket}`;
}

module.exports = {
  sha256,
  currentSessionId,
};
