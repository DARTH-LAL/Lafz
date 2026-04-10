import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

loadEnvFiles();

// The packaged desktop app should use the standalone desktop shell, not the
// consumer route that is only meant for dev/testing.
delete process.env.LAFZ_DESKTOP_URL;

// Default to ad-hoc signing so the packaged app is signed even before an
// Apple Developer certificate is configured. If you set APPLE_SIGNING_IDENTITY
// in your shell or .env.local, that value will win instead.
if (process.platform === "darwin" && !process.env.APPLE_SIGNING_IDENTITY) {
  process.env.APPLE_SIGNING_IDENTITY = "-";
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const updaterConfigPath = maybeCreateUpdaterConfigPatch();
const buildTargetTriple = readTargetTriple();

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || process.env[key] != null) {
      continue;
    }

    let value = trimmed.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadEnvFiles() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  loadEnvFile(resolve(process.cwd(), ".env"));
}

function parseUpdaterEndpoints(rawValue) {
  return String(rawValue ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function readTargetTriple() {
  const cliTargetIndex = process.argv.findIndex((value) => value === "--target" || value === "-t");
  if (cliTargetIndex !== -1 && process.argv[cliTargetIndex + 1]) {
    return process.argv[cliTargetIndex + 1].trim() || null;
  }

  const envTarget = process.env.LAFZ_BUILD_TARGET_TRIPLE?.trim();
  return envTarget ? envTarget : null;
}

function maybeCreateUpdaterConfigPatch() {
  const endpointsEnv = process.env.LAFZ_UPDATE_ENDPOINTS?.trim() ?? "";
  const pubkey = process.env.LAFZ_UPDATER_PUBKEY?.trim() ?? "";

  if (!endpointsEnv && !pubkey) {
    return null;
  }

  if (!endpointsEnv || !pubkey) {
    throw new Error("Set both LAFZ_UPDATE_ENDPOINTS and LAFZ_UPDATER_PUBKEY to enable auto-update.");
  }

  const endpoints = parseUpdaterEndpoints(endpointsEnv);

  if (endpoints.length === 0) {
    throw new Error("LAFZ_UPDATE_ENDPOINTS must include at least one URL.");
  }

  const allowInsecure = /^(1|true|yes|on)$/i.test(String(process.env.LAFZ_UPDATER_ALLOW_INSECURE ?? "").trim());

  if (!allowInsecure && endpoints.some((endpoint) => !endpoint.startsWith("https://"))) {
    throw new Error("Updater endpoints must use https unless LAFZ_UPDATER_ALLOW_INSECURE is enabled.");
  }

  if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    throw new Error("Auto-update requires TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH.");
  }

  const patch = {
    bundle: {
      createUpdaterArtifacts: true
    },
    plugins: {
      updater: {
        endpoints,
        pubkey,
        dangerousInsecureTransportProtocol: allowInsecure
      }
    }
  };

  const dir = resolve(tmpdir(), "lafz-tauri-build");
  mkdirSync(dir, { recursive: true });
  const patchPath = resolve(dir, `updater-config-${process.pid}.json`);
  writeFileSync(patchPath, `${JSON.stringify(patch, null, 2)}\n`, "utf8");
  return patchPath;
}

function runCommand(args) {
  const result = spawnSync(npmCommand, args, {
    stdio: "inherit",
    env: {
      ...process.env
    }
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

try {
  const buildArgs = ["exec", "tauri", "--", "build", "--no-bundle"];
  const bundleType = process.platform === "win32"
    ? "nsis"
    : process.platform === "darwin"
      ? "app"
      : "app";
  const bundleArgs = ["exec", "tauri", "--", "bundle", "--bundles", bundleType];

  if (buildTargetTriple) {
    buildArgs.push("--target", buildTargetTriple);
    bundleArgs.push("--target", buildTargetTriple);
  }

  if (updaterConfigPath) {
    buildArgs.push("--config", updaterConfigPath);
    bundleArgs.push("--config", updaterConfigPath);
  }

  runCommand(buildArgs);
  runCommand(bundleArgs);
} catch (error) {
  console.error("[desktop] Failed to build desktop bundle:", error);
  process.exit(1);
} finally {
  if (updaterConfigPath) {
    try {
      rmSync(updaterConfigPath, { force: true });
    } catch {
      // Ignore temp config cleanup failures.
    }
  }
}
