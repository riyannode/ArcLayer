/**
 * ERC-8183 lifecycle constants and helpers.
 * On-chain status mapping:
 *   0 = Open
 *   1 = Funded
 *   2 = Submitted
 *   3 = Completed
 */

const Status = Object.freeze({
  Open: 0,
  Funded: 1,
  Submitted: 2,
  Completed: 3,
});

/** Status name from numeric value */
function statusName(value) {
  return Object.keys(Status).find((k) => Status[k] === value) || `unknown(${value})`;
}

/** Status name from string (e.g. "Open", "Funded") */
function statusFromName(name) {
  if (!name) return null;
  const normalized = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return Status[normalized] !== undefined ? Status[normalized] : null;
}

function isOpen(job) {
  const s = job.erc8183Status || job.onchainStatus || job.lifecycleStatus;
  return s === 'Open' || s === 0;
}

function isFunded(job) {
  const s = job.erc8183Status || job.onchainStatus || job.lifecycleStatus;
  return s === 'Funded' || s === 1;
}

function isSubmitted(job) {
  const s = job.erc8183Status || job.onchainStatus || job.lifecycleStatus;
  return s === 'Submitted' || s === 2;
}

function isCompleted(job) {
  const s = job.erc8183Status || job.onchainStatus || job.lifecycleStatus;
  return s === 'Completed' || s === 3;
}

/** Should skip this job because it's older than the cutoff? */
function shouldIgnoreStaleJob(job, cutoffIso) {
  if (!cutoffIso) return false;
  const jobTime = new Date(job.createdAt || job.created_at || 0).getTime();
  const cutoff = new Date(cutoffIso).getTime();
  return jobTime < cutoff;
}

module.exports = {
  Status,
  statusName,
  statusFromName,
  isOpen,
  isFunded,
  isSubmitted,
  isCompleted,
  shouldIgnoreStaleJob,
};
