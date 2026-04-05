# Lafz Brain Worker

## Recommended modes

- `LAFZ_AGENT_RUNTIME_MODE=disabled`
  - safe default for laptops and contributor machines
- `LAFZ_AGENT_RUNTIME_MODE=embedded`
  - the web app process itself polls and processes jobs
- `LAFZ_AGENT_RUNTIME_MODE=standalone`
  - use a separate daemon that calls the protected internal worker route

## Recommended production setup

Use one dedicated host for worker execution.

### Web app host

Set:

```env
LAFZ_AGENT_RUNTIME_MODE=disabled
LAFZ_AGENT_RUNNER_SECRET=your-shared-secret
LAFZ_APP_URL=https://your-app-domain
```

The web app stays responsible for:

- enqueueing agent jobs
- exposing the protected internal worker route
- exposing worker status at `/api/brain?mode=worker-status`

### Worker host

Set:

```env
LAFZ_AGENT_RUNTIME_MODE=standalone
LAFZ_AGENT_AUTO_BACKLOG_ENABLED=true
LAFZ_AGENT_BACKLOG_BATCH_SIZE=5
LAFZ_AGENT_BACKLOG_REFILL_COOLDOWN_MS=60000
LAFZ_AGENT_MAX_ATTEMPTS=3
LAFZ_AGENT_RETRY_BASE_MS=30000
LAFZ_AGENT_RETRY_MAX_MS=600000
LAFZ_AGENT_STALE_JOB_TIMEOUT_MS=900000
LAFZ_CLEANUP_AGENT_HEARTBEAT_MS=30000
LAFZ_AGENT_RUNNER_SECRET=your-shared-secret
LAFZ_APP_URL=https://your-app-domain
LAFZ_AGENT_WORKER_POLL_MS=15000
LAFZ_BRAIN_WORKER_AGENTS=vocabulary,entity,motif,persona,cleanup
LAFZ_BRAIN_WORKER_MAX_JOBS=3
```

Run:

```bash
npm run agent:brain:daemon
```

This host will:

- poll the protected internal routes for:
  - `vocabulary`
  - `entity`
  - `motif`
  - `persona`
  - `cleanup`
- process queued jobs continuously in one worker loop
- auto-refill from old translated songs when the queue runs dry
- retry failed jobs with backoff before dead-lettering them
- reclaim stale `running` or `claimed` jobs after the timeout above so a restart does not strand the queue
- heartbeat long cleanup runs so they don't look dead while still making progress
- avoid running on contributor laptops by default

## Useful commands

Run one tick only:

```bash
npm run agent:brain:daemon -- --once
```

Run one agent only:

```bash
npm run agent:brain:daemon -- --agents=cleanup
```

Backfill old vocabulary jobs into the queue:

```bash
npm run backfill:vocabulary:jobs
```

Benchmark the critic eval set:

```bash
npm run benchmark:brain:critic
```

## Status

Check worker/queue status:

```text
/api/brain?mode=worker-status
```

This returns:

- current worker runtime mode on the app host
- queue counts by status for all agents
- critic evaluation summary for the review queue benchmark
- recent agent jobs
- recent agent runs
- recent contribution totals
