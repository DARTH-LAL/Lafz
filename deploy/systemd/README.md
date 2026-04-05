# Lafz systemd deployment

These templates run Lafz as two always-on services:

- `lafz-web.service` for the Next.js app
- `lafz-brain-worker.service` for the background brain daemon

## Layout

Recommended host paths:

- repo checkout: `/opt/lafz`
- env files: `/etc/lafz/*.env`

## Setup

1. Install the repo on the server at `/opt/lafz`.
2. Create a system user for the app, for example `lafz`.
3. Copy the example env files to `/etc/lafz/`:
   - `deploy/systemd/lafz-shared.env.example` -> `/etc/lafz/lafz-shared.env`
   - `deploy/systemd/lafz-web.env.example` -> `/etc/lafz/lafz-web.env`
   - `deploy/systemd/lafz-worker.env.example` -> `/etc/lafz/lafz-worker.env`
4. Fill in the real secrets and URLs.
5. Copy the service files into `/etc/systemd/system/`.
6. Run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lafz-web.service lafz-brain-worker.service
```

## If the website stays on Vercel

If your Next.js app is already deployed on Vercel, you do not need the `lafz-web.service` unit on the VPS.

Use the VPS for only the always-on worker:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lafz-brain-worker.service
```

In that split setup:

- Vercel hosts the website and the protected internal routes.
- The VPS runs the brain daemon.
- `LAFZ_APP_URL` should point to your Vercel production URL.
- `LAFZ_AGENT_RUNNER_SECRET` must match on both sides.

## Notes

- The web service expects you to have already run `npm ci` and `npm run build`.
- If Node is installed somewhere unusual, edit `ExecStart` or the `PATH` line in the service files before enabling them.
- The worker daemon talks to the web app through `LAFZ_APP_URL`.
- If the web app and worker live on the same host, set `LAFZ_APP_URL=http://127.0.0.1:3000`.
- The worker service is enough for all brain agents because `agent:brain:daemon` coordinates vocabulary, entity, motif, persona, and cleanup in one loop.
- Check health through `/api/brain?mode=worker-status`.
