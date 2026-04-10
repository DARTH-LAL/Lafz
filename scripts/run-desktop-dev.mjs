import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

loadEnvFiles();

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const desktopPort = Number(process.env.LAFZ_DESKTOP_PORT || "3001");
const desktopUrl = `http://127.0.0.1:${desktopPort}/consumer`;

let devServer = null;
let tauriProcess = null;
let shuttingDown = false;

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || process.env[key] != null) continue;
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

function log(message) {
  console.log(`[desktop] ${message}`);
}

function spawnCommand(command, args, extraEnv = {}) {
  return spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv }
  });
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(false));
    });
    server.on("error", () => resolve(true));
  });
}

function waitForPort(port, timeout = 60_000) {
  const net = require("node:net");
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.connect(port, "127.0.0.1", () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeout) reject(new Error(`Timed out waiting for port ${port}`));
        else setTimeout(check, 500);
      });
      socket.on("timeout", () => {
        socket.destroy();
        if (Date.now() - start > timeout) reject(new Error(`Timed out waiting for port ${port}`));
        else setTimeout(check, 500);
      });
    }
    check();
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (tauriProcess && !tauriProcess.killed) tauriProcess.kill("SIGTERM");
  if (devServer && !devServer.killed) devServer.kill("SIGTERM");
  process.exit(exitCode);
}

async function main() {
  log(`Desktop URL: ${desktopUrl}`);

  const alreadyRunning = await isPortListening(desktopPort);

  if (!alreadyRunning) {
    log(`Starting Next.js on port ${desktopPort}...`);
    devServer = spawnCommand(npmCommand, ["run", "dev:desktop"]);
    log("Waiting for Next.js to be ready...");
    await waitForPort(desktopPort);
    log("Next.js ready.");
  } else {
    log(`Next.js already running on port ${desktopPort}.`);
  }

  log("Launching Tauri...");
  tauriProcess = spawnCommand(npmCommand, ["exec", "tauri", "--", "dev"], {
    LAFZ_DESKTOP_URL: desktopUrl
  });

  tauriProcess.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const label = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    log(`Tauri exited with ${label}`);
    shutdown(code ?? 0);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error("[desktop] Failed to start desktop runner:", error);
  shutdown(1);
});
