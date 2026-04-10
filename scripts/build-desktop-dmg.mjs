import { existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const desktopDir = resolve(homedir(), "Desktop");
const x86AppPath = resolve(repoRoot, "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Lafz.app");
const armAppPath = resolve(repoRoot, "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Lafz.app");
const universalAppPath = resolve(desktopDir, "Lafz-universal.app");
const dmgPath = resolve(desktopDir, "Lafz-beta-installer-universal.dmg");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env },
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status ?? 1}`);
  }
}

function ensureBundleExists(bundlePath, label) {
  if (!existsSync(bundlePath)) {
    throw new Error(`${label} bundle not found at ${bundlePath}. Build both desktop targets first.`);
  }
}

function removeIfExists(path) {
  rmSync(path, { recursive: true, force: true });
}

function main() {
  ensureBundleExists(x86AppPath, "Intel");
  ensureBundleExists(armAppPath, "Apple Silicon");

  removeIfExists(universalAppPath);
  removeIfExists(dmgPath);

  console.log(`[desktop:dmg] Creating universal app at ${universalAppPath}`);
  run("ditto", [x86AppPath, universalAppPath]);

  const universalBinary = resolve(universalAppPath, "Contents/MacOS/lafz-desktop");
  const x86Binary = resolve(x86AppPath, "Contents/MacOS/lafz-desktop");
  const armBinary = resolve(armAppPath, "Contents/MacOS/lafz-desktop");

  console.log("[desktop:dmg] Merging arm64 and x86_64 executables with lipo");
  run("lipo", ["-create", armBinary, x86Binary, "-output", universalBinary]);
  run("chmod", ["+x", universalBinary]);

  const identity = String(process.env.APPLE_SIGNING_IDENTITY ?? "-").trim() || "-";
  const entitlements = resolve(repoRoot, "src-tauri/Entitlements.plist");
  console.log(`[desktop:dmg] Re-signing universal app with identity ${identity}`);
  run("codesign", [
    "--force",
    "--deep",
    "--sign",
    identity,
    "--entitlements",
    entitlements,
    universalAppPath
  ]);

  const stagingDir = resolve(process.env.TMPDIR ?? "/tmp", `lafz-dmg-${process.pid}`);
  removeIfExists(stagingDir);
  mkdirSync(stagingDir, { recursive: true });
  const stagedAppPath = resolve(stagingDir, "Lafz.app");
  console.log("[desktop:dmg] Staging DMG contents");
  run("ditto", [universalAppPath, stagedAppPath]);
  run("ln", ["-s", "/Applications", resolve(stagingDir, "Applications")]);

  console.log(`[desktop:dmg] Creating DMG at ${dmgPath}`);
  run("hdiutil", [
    "create",
    "-volname",
    "Lafz",
    "-srcfolder",
    stagingDir,
    "-ov",
    "-format",
    "UDZO",
    dmgPath
  ]);

  removeIfExists(stagingDir);

  console.log("");
  console.log(`[desktop:dmg] Universal app: ${universalAppPath}`);
  console.log(`[desktop:dmg] DMG: ${dmgPath}`);
}

try {
  main();
} catch (error) {
  console.error("[desktop:dmg] Failed to build DMG:", error);
  process.exit(1);
}
