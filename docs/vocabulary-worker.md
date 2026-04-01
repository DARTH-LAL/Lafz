# Lafz Vocabulary Worker

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

- enqueueing `vocabulary_agent` jobs
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
LAFZ_AGENT_RUNNER_SECRET=your-shared-secret
LAFZ_APP_URL=https://your-app-domain
LAFZ_AGENT_WORKER_POLL_MS=15000
LAFZ_AGENT_WORKER_ID=lafz-prod-worker-1
```

Run:

```bash
npm run agent:vocabulary:daemon
```

This host will:

- poll the protected internal vocabulary-agent route
- process queued jobs continuously
- auto-refill from old translated songs when the queue runs dry
- retry failed jobs with backoff before dead-lettering them
- avoid running on contributor laptops by default

## Useful commands

Run one tick only:

```bash
npm run agent:vocabulary:daemon -- --once
```

Backfill old songs into the queue:

```bash
npm run backfill:vocabulary:jobs
```

Backfill a small sample:

```bash
npm run backfill:vocabulary:jobs -- --limit=5
```

## Status

Check worker/queue status:

```text
/api/brain?mode=worker-status
```

This returns:

- current worker runtime mode on the app host
- queue counts by status
- recent vocabulary-agent jobs
- recent vocabulary-agent runs
- recent contribution totals
