/**
 * Evaluator Checkpoint — Persistent state for evaluator bot.
 *
 * Tracks per-job evaluation state to prevent duplicate transactions.
 * State file: .arclayer-evaluator-state.json (in bot root dir)
 *
 * Phases:
 *   submitted_seen → evaluation_started → evaluation_completed
 *   → complete_tx_sent → complete_tx_confirmed
 *   → reject_tx_sent → reject_tx_confirmed
 *   → needs_review
 *   → terminal_detected
 *   → failed
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.arclayer-evaluator-state.json');

class EvaluatorCheckpoint {
  constructor(stateFilePath) {
    this.filePath = stateFilePath || STATE_FILE;
    this.state = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn(`[CHECKPOINT] Failed to load state: ${err.message}, starting fresh`);
    }
    return { jobs: {}, updatedAt: new Date().toISOString() };
  }

  _save() {
    this.state.updatedAt = new Date().toISOString();
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[CHECKPOINT] Failed to save state: ${err.message}`);
    }
  }

  /**
   * Get checkpoint for a job.
   * @param {string} jobId
   * @returns {Object|null}
   */
  getJob(jobId) {
    return this.state.jobs[jobId] || null;
  }

  /**
   * Update checkpoint for a job.
   * @param {string} jobId
   * @param {Object} update - fields to merge
   */
  updateJob(jobId, update) {
    const existing = this.state.jobs[jobId] || {
      jobId,
      firstSeenAt: new Date().toISOString(),
    };

    this.state.jobs[jobId] = {
      ...existing,
      ...update,
      updatedAt: new Date().toISOString(),
    };

    this._save();
  }

  /**
   * Check if a job already has a pending or confirmed tx.
   * Prevents duplicate complete/reject transactions.
   * @param {string} jobId
   * @returns {boolean}
   */
  hasPendingOrConfirmedTx(jobId) {
    const job = this.state.jobs[jobId];
    if (!job) return false;

    const txPhases = new Set([
      'complete_tx_sent',
      'complete_tx_confirmed',
      'reject_tx_sent',
      'reject_tx_confirmed',
    ]);

    return txPhases.has(job.phase);
  }

  /**
   * Check if a job is in a terminal evaluation state.
   * @param {string} jobId
   * @returns {boolean}
   */
  isTerminal(jobId) {
    const job = this.state.jobs[jobId];
    if (!job) return false;

    const terminalPhases = new Set([
      'complete_tx_confirmed',
      'reject_tx_confirmed',
      'terminal_detected',
      'needs_review',
    ]);

    return terminalPhases.has(job.phase);
  }

  /**
   * Get the current phase for a job.
   * @param {string} jobId
   * @returns {string|null}
   */
  getPhase(jobId) {
    const job = this.state.jobs[jobId];
    return job?.phase || null;
  }

  /**
   * Get all jobs in a specific phase.
   * @param {string} phase
   * @returns {string[]} jobIds
   */
  getJobsByPhase(phase) {
    return Object.entries(this.state.jobs)
      .filter(([, job]) => job.phase === phase)
      .map(([jobId]) => jobId);
  }

  /**
   * Get count of active (non-terminal) jobs.
   * @returns {number}
   */
  getActiveCount() {
    return Object.values(this.state.jobs).filter(
      (j) => !['complete_tx_confirmed', 'reject_tx_confirmed', 'terminal_detected', 'needs_review', 'failed'].includes(j.phase)
    ).length;
  }
}

module.exports = { EvaluatorCheckpoint };
