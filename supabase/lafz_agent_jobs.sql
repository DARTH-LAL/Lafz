create table if not exists agent_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  job_type text not null,
  status text not null default 'pending',
  scope_type text not null,
  scope_key text not null,
  spotify_track_id text,
  priority integer not null default 100,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  last_heartbeat_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_jobs_status_available_idx on agent_jobs (status, available_at, priority);
create index if not exists agent_jobs_type_status_idx on agent_jobs (job_type, status);
create index if not exists agent_jobs_scope_idx on agent_jobs (scope_type, scope_key);
create index if not exists agent_jobs_track_idx on agent_jobs (spotify_track_id);
create index if not exists agent_jobs_claimed_idx on agent_jobs (claimed_by, claimed_at);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references agent_jobs(id) on delete cascade,
  agent_role text not null,
  status text not null default 'running',
  worker_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_runs_job_idx on agent_runs (job_id);
create index if not exists agent_runs_status_idx on agent_runs (status, started_at);
create index if not exists agent_runs_worker_idx on agent_runs (worker_id, started_at);

create or replace function claim_next_agent_job(p_worker_id text, p_job_type text default null)
returns setof agent_jobs
language sql
as $$
  with next_job as (
    select id
    from agent_jobs
    where status = 'pending'
      and available_at <= now()
      and (p_job_type is null or job_type = p_job_type)
    order by priority asc, created_at asc
    limit 1
    for update skip locked
  )
  update agent_jobs
  set
    status = 'claimed',
    claimed_at = now(),
    claimed_by = p_worker_id,
    last_heartbeat_at = now(),
    attempt_count = attempt_count + 1,
    updated_at = now()
  where id in (select id from next_job)
  returning *;
$$;
