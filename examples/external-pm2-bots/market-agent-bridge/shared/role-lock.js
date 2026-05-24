const path = require('node:path');
const fs = require('node:fs');

const LOCK_DIR = path.resolve(__dirname, '..', '.x402-locks');

function ensureLockDir() {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
}

function lockPath(sessionId, role) {
  return path.join(LOCK_DIR, `${sessionId}-${role}.lock`);
}

/**
 * Acquire an atomic file lock for a session+role.
 * Uses fs.openSync with 'wx' flag (exclusive create).
 * Returns the lock path on success, null if lock exists.
 * Never throws.
 */
function acquireRoleLock(sessionId, role) {
  try {
    ensureLockDir();
    const lp = lockPath(sessionId, role);
    const fd = fs.openSync(lp, 'wx');
    fs.closeSync(fd);
    return lp;
  } catch (err) {
    if (err && err.code === 'EEXIST') return null;
    // Unexpected error — log and treat as lock-failed (safety: don't proceed)
    console.error(`[role-lock] acquire error session=${sessionId} role=${role} err=${err.code || err.message}`);
    return null;
  }
}

/**
 * Release a file lock. Never throws.
 */
function releaseRoleLock(lockPath) {
  try {
    if (lockPath) fs.unlinkSync(lockPath);
  } catch {
    // Best-effort cleanup
  }
}

module.exports = { acquireRoleLock, releaseRoleLock };
