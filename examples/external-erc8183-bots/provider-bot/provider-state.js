/**
 * Durable Provider State — persists job skip/submit/budget tracking across restarts.
 *
 * Atomic writes: write to temp file then rename.
 * Caps each category to MAX_ENTRIES (500).
 * Corrupt file = warn + recover with empty state.
 * No secrets stored — only job IDs, timestamps, error codes, counts.
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_ENTRIES = 500;
const STATE_VERSION = 1;

/**
 * @param {string} filePath - absolute path to state file
 * @returns {Object} state manager API
 */
function createProviderState(filePath) {
  const resolvedPath = path.resolve(filePath);
  let state = loadState(resolvedPath);

  // Periodic save every 30s (debounced — only saves if dirty)
  let dirty = false;
  const saveInterval = setInterval(() => {
    if (dirty) {
      saveState(resolvedPath, state);
      dirty = false;
    }
  }, 30_000);

  // Save on process exit
  const saveOnExit = () => {
    if (dirty) {
      try { saveState(resolvedPath, state); } catch { /* best effort */ }
    }
  };
  process.on('SIGINT', saveOnExit);
  process.on('SIGTERM', saveOnExit);
  process.on('exit', saveOnExit);

  function markDirty() {
    dirty = true;
  }

  return {
    /** Get the full state object (read-only reference). */
    get() { return state; },

    /** Record a skipped job with reason. */
    skipJob(jobId, reason) {
      const key = String(jobId);
      if (!state.skippedJobIds[key]) {
        state.skippedJobIds[key] = { reason: String(reason || 'unknown'), at: Date.now() };
        trimMap(state.skippedJobIds);
        markDirty();
      }
    },

    /** Check if a job was previously skipped. */
    isSkipped(jobId) {
      return !!state.skippedJobIds[String(jobId)];
    },

    /** Record a known-bad job (will not retry after restart). */
    markBadJob(jobId, reason) {
      const key = String(jobId);
      if (!state.knownBadJobIds[key]) {
        state.knownBadJobIds[key] = { reason: String(reason || 'unknown'), at: Date.now() };
        trimMap(state.knownBadJobIds);
        markDirty();
      }
    },

    /** Check if a job is known-bad. */
    isBadJob(jobId) {
      return !!state.knownBadJobIds[String(jobId)];
    },

    /** Record a successful submit. */
    recordSubmit(jobId) {
      const key = String(jobId);
      state.lastSubmittedJobIds[key] = Date.now();
      trimMap(state.lastSubmittedJobIds);
      markDirty();
    },

    /** Check if job was already submitted. */
    wasSubmitted(jobId) {
      return !!state.lastSubmittedJobIds[String(jobId)];
    },

    /** Record a successful setBudget. */
    recordSetBudget(jobId) {
      const key = String(jobId);
      state.lastSetBudgetJobIds[key] = Date.now();
      trimMap(state.lastSetBudgetJobIds);
      markDirty();
    },

    /** Check if job already had setBudget called. */
    wasSetBudget(jobId) {
      return !!state.lastSetBudgetJobIds[String(jobId)];
    },

    /** Increment repair counter. */
    incrementRepair() {
      state.repairCount++;
      markDirty();
    },

    /** Record an error code. */
    recordError(code) {
      state.lastErrorCode = String(code || 'unknown');
      state.lastErrorAt = Date.now();
      markDirty();
    },

    /** Record job error with backoff tracking. */
    recordJobError(jobId, errorCode) {
      const key = String(jobId);
      if (!state.jobErrors[key]) {
        state.jobErrors[key] = { count: 0, lastAt: 0, codes: [] };
      }
      const entry = state.jobErrors[key];
      entry.count++;
      entry.lastAt = Date.now();
      entry.codes.push(String(errorCode || 'unknown'));
      // Keep only last 5 error codes
      if (entry.codes.length > 5) entry.codes = entry.codes.slice(-5);
      trimMap(state.jobErrors);
      markDirty();
    },

    /** Get job error entry. */
    getJobErrors(jobId) {
      return state.jobErrors[String(jobId)] || null;
    },

    /** Clear job errors (on success). */
    clearJobErrors(jobId) {
      const key = String(jobId);
      if (state.jobErrors[key]) {
        delete state.jobErrors[key];
        markDirty();
      }
    },

    /** Get counts for diagnostics. */
    getCounts() {
      return {
        skippedJobsCount: Object.keys(state.skippedJobIds).length,
        knownBadJobsCount: Object.keys(state.knownBadJobIds).length,
        submittedCount: Object.keys(state.lastSubmittedJobIds).length,
        setBudgetCount: Object.keys(state.lastSetBudgetJobIds).length,
        repairCount: state.repairCount,
        lastErrorCode: state.lastErrorCode,
        lastErrorAt: state.lastErrorAt,
      };
    },

    /** Force save now. */
    flush() {
      saveState(resolvedPath, state);
      dirty = false;
    },

    /** Stop periodic save. */
    stop() {
      clearInterval(saveInterval);
      saveOnExit();
    },
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────

function emptyState() {
  return {
    version: STATE_VERSION,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    skippedJobIds: {},
    knownBadJobIds: {},
    lastSubmittedJobIds: {},
    lastSetBudgetJobIds: {},
    jobErrors: {},
    repairCount: 0,
    lastErrorCode: null,
    lastErrorAt: null,
  };
}

function loadState(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return emptyState();
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    // Validate basic structure
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn(`[state] Corrupt state file — recovering with empty state`);
      return emptyState();
    }

    // Migrate/repair missing fields
    const state = emptyState();
    state.skippedJobIds = isObject(parsed.skippedJobIds) ? parsed.skippedJobIds : {};
    state.knownBadJobIds = isObject(parsed.knownBadJobIds) ? parsed.knownBadJobIds : {};
    state.lastSubmittedJobIds = isObject(parsed.lastSubmittedJobIds) ? parsed.lastSubmittedJobIds : {};
    state.lastSetBudgetJobIds = isObject(parsed.lastSetBudgetJobIds) ? parsed.lastSetBudgetJobIds : {};
    state.jobErrors = isObject(parsed.jobErrors) ? parsed.jobErrors : {};
    state.repairCount = typeof parsed.repairCount === 'number' ? parsed.repairCount : 0;
    state.lastErrorCode = parsed.lastErrorCode || null;
    state.lastErrorAt = typeof parsed.lastErrorAt === 'number' ? parsed.lastErrorAt : null;
    state.createdAt = typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now();

    // Trim all maps on load — prevents unbounded growth across restarts
    trimMap(state.skippedJobIds);
    trimMap(state.knownBadJobIds);
    trimMap(state.lastSubmittedJobIds);
    trimMap(state.lastSetBudgetJobIds);
    trimMap(state.jobErrors);

    console.log(`[state] Loaded provider state from ${path.basename(filePath)}: ` +
      `skipped=${Object.keys(state.skippedJobIds).length}, ` +
      `bad=${Object.keys(state.knownBadJobIds).length}, ` +
      `submitted=${Object.keys(state.lastSubmittedJobIds).length}, ` +
      `repairs=${state.repairCount}`);

    return state;
  } catch (err) {
    console.warn(`[state] Failed to load state file — recovering with empty state: ${err.message}`);
    return emptyState();
  }
}

function saveState(filePath, state) {
  try {
    state.updatedAt = Date.now();
    const tmpPath = filePath + '.tmp';
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn(`[state] Failed to save state: ${err.message}`);
  }
}

function trimMap(map) {
  const keys = Object.keys(map);
  if (keys.length > MAX_ENTRIES) {
    // Sort by timestamp (oldest first) and remove excess
    const sorted = keys
      .map(k => ({ key: k, val: map[k] }))
      .sort((a, b) => {
        const aTime = typeof a.val === 'object' ? (a.val.at || 0) : (a.val || 0);
        const bTime = typeof b.val === 'object' ? (b.val.at || 0) : (b.val || 0);
        return aTime - bTime;
      });
    const toRemove = sorted.slice(0, keys.length - MAX_ENTRIES);
    for (const entry of toRemove) {
      delete map[entry.key];
    }
  }
}

function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

module.exports = { createProviderState };
