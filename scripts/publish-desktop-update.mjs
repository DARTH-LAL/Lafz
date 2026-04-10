import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const root = process.cwd();
const targetRoot = path.join(root, "src-tauri", "target");
const packageJsonPath = path.join(root, "package.json");
const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function optionalEnv(name) {
  return process.env[name]?.trim() ?? "";
}

function normalizeArch(arch) {
  switch (arch) {
    case "x64":
      return "x86_64";
    case "arm64":
      return "aarch64";
    case "ia32":
      return "i686";
    case "arm":
      return "armv7";
    default:
      return arch;
  }
}

function currentTargetKey() {
  const target = process.platform === "darwin"
    ? "darwin"
    : process.platform === "win32"
      ? "windows"
      : "linux";

  return `${target}-${normalizeArch(process.arch)}`;
}

function currentBundleFolder() {
  return process.platform === "darwin"
    ? "macos"
    : process.platform === "win32"
      ? "nsis"
      : "appimage";
}

function currentArtifactMatchers(productName) {
  if (process.platform === "darwin") {
    return [
      new RegExp(`^${escapeRegex(productName)}\\.app\\.tar\\.gz$`)
    ];
  }

  if (process.platform === "win32") {
    return [
      new RegExp(`^${escapeRegex(productName)}-setup\\.nsis\\.zip$`),
      new RegExp(`^${escapeRegex(productName)}\\.msi\\.zip$`)
    ];
  }

  return [
    new RegExp(`^${escapeRegex(productName)}\\.AppImage\\.tar\\.gz$`)
  ];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function listFilesRecursively(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listFilesRecursively(fullPath)));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function makeR2Client() {
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });
}

async function findNewestMatchingFile(files, matchers, bundleFolder) {
  const candidates = [];

  for (const filePath of files) {
    if (!filePath.includes(`${path.sep}bundle${path.sep}${bundleFolder}${path.sep}`)) {
      continue;
    }

    const fileName = path.basename(filePath);
    if (!matchers.some((matcher) => matcher.test(fileName))) {
      continue;
    }

    const fileStat = await stat(filePath);
    candidates.push({
      filePath,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs
    });
  }

  candidates.sort((left, right) => {
    if (left.mtimeMs !== right.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }

    if (left.size !== right.size) {
      return right.size - left.size;
    }

    return left.filePath.localeCompare(right.filePath);
  });

  return candidates[0]?.filePath ?? null;
}

function contentTypeForFile(filePath) {
  if (filePath.endsWith(".tar.gz")) {
    return "application/gzip";
  }

  if (filePath.endsWith(".zip")) {
    return "application/zip";
  }

  if (filePath.endsWith(".sig")) {
    return "text/plain; charset=utf-8";
  }

  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  return "application/octet-stream";
}

function joinUrl(baseUrl, ...parts) {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const normalizedParts = parts
    .flat()
    .filter(Boolean)
    .map((part) => String(part).replace(/^\/+|\/+$/g, ""));

  return `${trimmedBase}/${normalizedParts.join("/")}`;
}

async function putObject(client, bucket, key, body, contentType) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
}

async function main() {
  const packageJson = await readJson(packageJsonPath);
  const tauriConfig = await readJson(tauriConfigPath);

  const productName = tauriConfig.productName?.trim() || packageJson.name || "Lafz";
  const version = packageJson.version?.trim();

  if (!version) {
    throw new Error("Could not read package version from package.json.");
  }

  const publicBaseUrl = optionalEnv("LAFZ_UPDATE_BASE_URL")
    || optionalEnv("R2_PUBLIC_BASE_URL")
    || optionalEnv("LAFZ_UPDATE_PUBLIC_BASE_URL");

  if (!publicBaseUrl) {
    throw new Error("Set LAFZ_UPDATE_BASE_URL (or R2_PUBLIC_BASE_URL) to the public R2 base URL for update files.");
  }

  const prefix = optionalEnv("LAFZ_UPDATE_PREFIX") || "desktop-updates";
  const notes = optionalEnv("LAFZ_UPDATE_NOTES");
  const bundleFolder = currentBundleFolder();
  const targetKey = currentTargetKey();
  const artifactMatchers = currentArtifactMatchers(productName);
  const client = makeR2Client();
  const bucket = requiredEnv("R2_BUCKET");

  const files = await listFilesRecursively(targetRoot);
  const artifactPath = await findNewestMatchingFile(files, artifactMatchers, bundleFolder);

  if (!artifactPath) {
    throw new Error(
      [
        "No desktop updater artifact was found.",
        `Looked under ${path.relative(root, targetRoot)} for a ${bundleFolder} bundle.`,
        "Run the desktop build with updater artifacts enabled first, then run this publish script again."
      ].join(" ")
    );
  }

  const signaturePath = `${artifactPath}.sig`;
  const signatureRaw = await readFile(signaturePath, "utf8").catch(() => null);

  if (!signatureRaw?.trim()) {
    throw new Error(`Missing updater signature file: ${path.relative(root, signaturePath)}`);
  }

  const artifactName = path.basename(artifactPath);
  const signatureName = path.basename(signaturePath);

  const manifestKey = `${prefix}/${targetKey}/latest.json`;
  const artifactKey = `${prefix}/${targetKey}/${version}/${artifactName}`;
  const signatureKey = `${prefix}/${targetKey}/${version}/${signatureName}`;
  const artifactUrl = joinUrl(publicBaseUrl, artifactKey);
  const manifest = {
    version,
    ...(notes ? { notes } : {}),
    pub_date: new Date().toISOString(),
    platforms: {
      [targetKey]: {
        url: artifactUrl,
        signature: signatureRaw.trim()
      }
    }
  };

  await putObject(client, bucket, artifactKey, await readFile(artifactPath), contentTypeForFile(artifactPath));
  await putObject(client, bucket, signatureKey, signatureRaw, contentTypeForFile(signaturePath));
  await putObject(
    client,
    bucket,
    manifestKey,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "application/json; charset=utf-8"
  );

  console.log("Desktop update published.");
  console.log(`Manifest: ${joinUrl(publicBaseUrl, manifestKey)}`);
  console.log(`Artifact:  ${artifactUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
