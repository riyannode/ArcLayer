import { describe, it, expect, beforeEach } from 'vitest';
import { createA2AJob, listA2AJobs, claimA2AJob, submitA2AJob, getA2AJob } from './jobs';

describe('A2A jobs store', () => {
  beforeEach(() => {
    // Reset global store between tests without replacing the module-held Map reference.
    (globalThis as unknown as { __arclayerA2AJobs?: Map<string, unknown> }).__arclayerA2AJobs?.clear();
    (globalThis as unknown as { __arclayerA2AJobSeq?: number }).__arclayerA2AJobSeq = 0;
  });

  it('createA2AJob returns deterministic-shaped record with status open', () => {
    const job = createA2AJob({ title: 'Test', description: 'Desc', requester: '0xabc' });
    expect(job.id).toMatch(/^job_[0-9a-f]{16}$/);
    expect(job.status).toBe('open');
    expect(job.title).toBe('Test');
    expect(job.requester).toBe('0xabc');
  });

  it('createA2AJob produces unique IDs across calls (sequence-based)', () => {
    const a = createA2AJob({ title: 'A', description: 'a' });
    const b = createA2AJob({ title: 'A', description: 'a' });
    expect(a.id).not.toBe(b.id);
  });

  it('listA2AJobs filters by status, agentId, roleId, category', () => {
    createA2AJob({ title: 'A', description: 'a', category: 'dev', roleId: 'r1' });
    createA2AJob({ title: 'B', description: 'b', category: 'pm', roleId: 'r2' });
    expect(listA2AJobs({ category: 'dev' })).toHaveLength(1);
    expect(listA2AJobs({ roleId: 'r2' })).toHaveLength(1);
    expect(listA2AJobs({ status: 'open' })).toHaveLength(2);
    expect(listA2AJobs({ status: 'claimed' })).toHaveLength(0);
  });

  it('claimA2AJob locks job to first agent and rejects others', () => {
    const job = createA2AJob({ title: 'X', description: 'x' });
    const first = claimA2AJob(job.id, 'agent-1');
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.job.status).toBe('claimed');

    const second = claimA2AJob(job.id, 'agent-2');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('job_already_claimed');

    // Idempotent for same agent
    const reclaim = claimA2AJob(job.id, 'agent-1');
    expect(reclaim.ok).toBe(true);
  });

  it('claimA2AJob returns job_not_found for unknown id', () => {
    const result = claimA2AJob('job_nope', 'agent-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('job_not_found');
  });

  it('submitA2AJob requires the claiming agentId', () => {
    const job = createA2AJob({ title: 'Y', description: 'y' });
    claimA2AJob(job.id, 'agent-1');
    const wrong = submitA2AJob(job.id, { agentId: 'agent-2', output: 'x' });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toBe('agent_did_not_claim_job');

    const right = submitA2AJob(job.id, { agentId: 'agent-1', output: 'done', proof: { type: 'signed_result' } });
    expect(right.ok).toBe(true);
    if (right.ok) {
      expect(right.job.status).toBe('submitted');
      expect(right.receipt.id).toMatch(/^receipt_[0-9a-f]{16}$/);
    }
  });

  it('submitA2AJob auto-claims if job is still open', () => {
    const job = createA2AJob({ title: 'Z', description: 'z' });
    const result = submitA2AJob(job.id, { agentId: 'agent-9', output: 'done' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.status).toBe('submitted');
      expect(result.job.claimedBy).toBe('agent-9');
    }
  });

  it('getA2AJob returns null for missing id', () => {
    expect(getA2AJob('job_missing')).toBeNull();
  });
});
