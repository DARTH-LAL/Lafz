function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function parseArgs(argv) {
  const options = {
    once: false,
    intervalMs: null,
    maxJobs: 3,
    workerId: process.env.LAFZ_CLEANUP_AGENT_WORKER_ID?.trim() || `lafz-standalone-cleanup-worker-${process.pid}`
  };

  for (const arg of argv) {
    if (arg === "--once") {
      options.once = true;
      continue;
    }

    if (arg.startsWith("--interval-ms=")) {
      const parsed = Number.parseInt(arg.slice("--interval-ms=".length), 10);
      options.intervalMs = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      continue;
    }

    if (arg.startsWith("--max-jobs=")) {
      const parsed = Number.parseInt(arg.slice("--max-jobs=".length), 10);
      options.maxJobs = Number.isFinite(parsed) && parsed > 0 ? parsed : options.maxJobs;
      continue;
    }

    if (arg.startsWith("--worker-id=")) {
      options.workerId = arg.slice("--worker-id=".length).trim() || options.workerId;
    }
  }

  return options;
}

function getPollIntervalMs(override) {
  if (override) {
    return override;
  }

  const parsed = Number.parseInt(process.env.LAFZ_AGENT_WORKER_POLL_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000;
}

function getAppUrl() {
  return (
    process.env.LAFZ_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    "http://127.0.0.1:3000"
  ).replace(/\/+$/, "");
}

async function runTick({ appUrl, secret, maxJobs, workerId }) {
  const response = await fetch(`${appUrl}/api/internal/brain/cleanup-agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`
    },
    body: JSON.stringify({
      maxJobs,
      workerId
    })
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const error = json && typeof json.error === "string" ? json.error : `HTTP ${response.status}`;
    throw new Error(error);
  }

  return json;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const appUrl = getAppUrl();
  const secret = requiredEnv("LAFZ_AGENT_RUNNER_SECRET");
  const intervalMs = getPollIntervalMs(options.intervalMs);

  console.log("[cleanup-worker-daemon] starting", {
    appUrl,
    intervalMs,
    maxJobs: options.maxJobs,
    once: options.once,
    workerId: options.workerId
  });

  do {
    try {
      const result = await runTick({
        appUrl,
        secret,
        maxJobs: options.maxJobs,
        workerId: options.workerId
      });

      console.log("[cleanup-worker-daemon] tick", {
        processedCount: result?.processedCount ?? 0,
        workerId: result?.workerId ?? options.workerId,
        runtimeMode: result?.status?.runtimeMode ?? null
      });
    } catch (error) {
      console.error(
        "[cleanup-worker-daemon] tick failed.",
        error instanceof Error ? error.message : String(error)
      );
    }

    if (options.once) {
      break;
    }

    await sleep(intervalMs);
  } while (true);
}

main().catch((error) => {
  console.error("[cleanup-worker-daemon] fatal error.", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
