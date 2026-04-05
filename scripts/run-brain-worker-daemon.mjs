const DEFAULT_AGENT_ORDER = ["vocabulary", "entity", "motif", "persona", "cleanup"];

const AGENT_DEFINITIONS = {
  vocabulary: {
    route: "/api/internal/brain/vocabulary-agent",
    workerIdEnv: "LAFZ_AGENT_WORKER_ID",
    fallbackPrefix: "lafz-standalone-worker"
  },
  entity: {
    route: "/api/internal/brain/entity-agent",
    workerIdEnv: "LAFZ_ENTITY_AGENT_WORKER_ID",
    fallbackPrefix: "lafz-standalone-entity-worker"
  },
  motif: {
    route: "/api/internal/brain/motif-agent",
    workerIdEnv: "LAFZ_MOTIF_AGENT_WORKER_ID",
    fallbackPrefix: "lafz-standalone-motif-worker"
  },
  persona: {
    route: "/api/internal/brain/persona-agent",
    workerIdEnv: "LAFZ_PERSONA_AGENT_WORKER_ID",
    fallbackPrefix: "lafz-standalone-persona-worker"
  },
  cleanup: {
    route: "/api/internal/brain/cleanup-agent",
    workerIdEnv: "LAFZ_CLEANUP_AGENT_WORKER_ID",
    fallbackPrefix: "lafz-standalone-cleanup-worker"
  }
};

const AGENT_QUEUE_FIELDS = {
  vocabulary: "queueCounts",
  entity: "entityQueueCounts",
  motif: "motifQueueCounts",
  persona: "personaQueueCounts",
  cleanup: "cleanupQueueCounts"
};

const AGENT_WORKER_FIELDS = {
  vocabulary: "worker",
  entity: "entityWorker",
  motif: "motifWorker",
  persona: "personaWorker",
  cleanup: "cleanupWorker"
};

const WORKER_STATUS_ROUTE = "/api/brain?mode=worker-status";
const DEFAULT_MAX_JOBS = 3;
const DEFAULT_POLL_INTERVAL_MS = 15_000;

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function parseAgentList(value) {
  if (!value) {
    return DEFAULT_AGENT_ORDER;
  }

  const requested = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const filtered = requested.filter((entry) => entry in AGENT_DEFINITIONS);

  return filtered.length > 0 ? filtered : DEFAULT_AGENT_ORDER;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseArgs(argv) {
  const options = {
    once: false,
    intervalMs: null,
    maxJobs: parsePositiveInteger(process.env.LAFZ_BRAIN_WORKER_MAX_JOBS, DEFAULT_MAX_JOBS),
    agents: parseAgentList(process.env.LAFZ_BRAIN_WORKER_AGENTS)
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

    if (arg.startsWith("--agents=")) {
      options.agents = parseAgentList(arg.slice("--agents=".length));
    }
  }

  return options;
}

function getPollIntervalMs(override) {
  if (override) {
    return override;
  }

  return parsePositiveInteger(process.env.LAFZ_AGENT_WORKER_POLL_MS, DEFAULT_POLL_INTERVAL_MS);
}

function getAppUrl() {
  return (
    process.env.LAFZ_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    "http://127.0.0.1:3000"
  ).replace(/\/+$/, "");
}

function getWorkerId(agentName) {
  const definition = AGENT_DEFINITIONS[agentName];
  const explicit = process.env[definition.workerIdEnv]?.trim();

  if (explicit) {
    return explicit;
  }

  return `${definition.fallbackPrefix}-${process.pid}`;
}

function getQueueCounts(workerStatus, agentName) {
  const field = AGENT_QUEUE_FIELDS[agentName];
  return workerStatus?.[field] ?? null;
}

function getWorkerStatus(workerStatus, agentName) {
  const field = AGENT_WORKER_FIELDS[agentName];
  return workerStatus?.[field] ?? null;
}

function readAgentSnapshot(workerStatus, agentName) {
  const queueCounts = getQueueCounts(workerStatus, agentName);
  const worker = getWorkerStatus(workerStatus, agentName);
  const jobHealth = worker?.jobHealth ?? null;
  const pending = parsePositiveInteger(queueCounts?.pending, 0);
  const claimed = parsePositiveInteger(queueCounts?.claimed, 0);
  const running = parsePositiveInteger(queueCounts?.running, 0);
  const staleJobCount = parsePositiveInteger(jobHealth?.staleJobCount, 0);
  const oldestStaleJobAgeMs = Number.isFinite(jobHealth?.oldestStaleJobAgeMs)
    ? jobHealth.oldestStaleJobAgeMs
    : null;

  return {
    agentName,
    queueCounts,
    worker,
    jobHealth,
    pending,
    claimed,
    running,
    staleJobCount,
    oldestStaleJobAgeMs,
    queuePressure: pending * 10 + claimed * 3 + running + staleJobCount * 100
  };
}

function buildSchedule(workerStatus, agents, cycleIndex) {
  if (!workerStatus) {
    const offset = cycleIndex % agents.length;
    return agents
      .map((agentName, index) => ({
        agentName,
        tieBreaker: (index - offset + agents.length) % agents.length
      }))
      .sort((left, right) => left.tieBreaker - right.tieBreaker)
      .map((entry) => entry.agentName);
  }

  const offset = cycleIndex % agents.length;
  return agents
    .map((agentName, index) => {
      const snapshot = readAgentSnapshot(workerStatus, agentName);

      return {
        ...snapshot,
        tieBreaker: (index - offset + agents.length) % agents.length
      };
    })
    .sort((left, right) => {
      if (right.queuePressure !== left.queuePressure) {
        return right.queuePressure - left.queuePressure;
      }

      if (right.staleJobCount !== left.staleJobCount) {
        return right.staleJobCount - left.staleJobCount;
      }

      if ((right.oldestStaleJobAgeMs ?? -1) !== (left.oldestStaleJobAgeMs ?? -1)) {
        return (right.oldestStaleJobAgeMs ?? -1) - (left.oldestStaleJobAgeMs ?? -1);
      }

      return left.tieBreaker - right.tieBreaker;
    })
    .map((entry) => entry.agentName);
}

async function readWorkerStatus({ appUrl, secret }) {
  const response = await fetch(`${appUrl}${WORKER_STATUS_ROUTE}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${secret}`
    }
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const error = json && typeof json.error === "string" ? json.error : `HTTP ${response.status}`;
    throw new Error(error);
  }

  return json;
}

async function runTick({ appUrl, secret, agentName, maxJobs }) {
  const definition = AGENT_DEFINITIONS[agentName];
  const workerId = getWorkerId(agentName);
  const response = await fetch(`${appUrl}${definition.route}`, {
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

  return {
    agentName,
    workerId,
    processedCount: json?.processedCount ?? 0,
    status: json?.status ?? null
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const appUrl = getAppUrl();
  const secret = requiredEnv("LAFZ_AGENT_RUNNER_SECRET");
  const intervalMs = getPollIntervalMs(options.intervalMs);

  console.log("[brain-worker-daemon] starting", {
    appUrl,
    intervalMs,
    maxJobs: options.maxJobs,
    once: options.once,
    agents: options.agents
  });

  let cycleIndex = 0;

  do {
    let cycleProcessed = 0;
    let workerStatus = null;

    try {
      workerStatus = await readWorkerStatus({ appUrl, secret });
    } catch (error) {
      console.warn("[brain-worker-daemon] could not read worker status; using fallback order.", {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const scheduledAgents = buildSchedule(workerStatus, options.agents, cycleIndex);

    console.log("[brain-worker-daemon] cycle", {
      cycleIndex,
      workerStatusAvailable: Boolean(workerStatus),
      order: scheduledAgents.map((agentName) => {
        const snapshot = workerStatus ? readAgentSnapshot(workerStatus, agentName) : null;

        return snapshot
          ? {
              agent: agentName,
              pending: snapshot.pending,
              staleJobCount: snapshot.staleJobCount,
              queuePressure: snapshot.queuePressure
            }
          : {
              agent: agentName
            };
      })
    });

    for (const agentName of scheduledAgents) {
      try {
        const result = await runTick({
          appUrl,
          secret,
          agentName,
          maxJobs: options.maxJobs
        });

        cycleProcessed += result.processedCount;

        console.log("[brain-worker-daemon] tick", {
          agent: agentName,
          processedCount: result.processedCount,
          workerId: result.workerId,
          runtimeMode: result.status?.runtimeMode ?? null
        });
      } catch (error) {
        console.error("[brain-worker-daemon] tick failed.", {
          agent: agentName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    cycleIndex += 1;

    if (options.once) {
      break;
    }

    if (cycleProcessed === 0) {
      await sleep(intervalMs);
    }
  } while (true);
}

main().catch((error) => {
  console.error("[brain-worker-daemon] fatal error.", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
