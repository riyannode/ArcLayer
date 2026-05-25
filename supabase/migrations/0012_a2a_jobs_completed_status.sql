alter table a2a_jobs
  drop constraint if exists a2a_jobs_status_check;

alter table a2a_jobs
  add constraint a2a_jobs_status_check
  check (status in ('open', 'claimed', 'submitted', 'completed', 'failed'));

alter table a2a_jobs
  add column if not exists completed_at timestamptz,
  add column if not exists failed_at timestamptz;

create index if not exists a2a_jobs_completed_at_idx
  on a2a_jobs (completed_at desc);

notify pgrst, 'reload schema';
