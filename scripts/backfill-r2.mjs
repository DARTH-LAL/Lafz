import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const root = process.cwd();
const dataRoot = path.join(root, "data");

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

async function listJsonFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listJsonFiles(fullPath)));
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
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

function createR2Client() {
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

async function uploadJsonFile(client, bucket, key, filePath) {
  const raw = await readFile(filePath, "utf8");

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: raw,
      ContentType: "application/json; charset=utf-8"
    })
  );
}

async function backfillDataTree(client, bucket) {
  const files = await listJsonFiles(dataRoot);
  let successCount = 0;
  let skippedCount = 0;

  for (const filePath of files) {
    try {
      const key = path.relative(root, filePath).replace(/\\/g, "/");
      await uploadJsonFile(client, bucket, key, filePath);
      successCount += 1;
    } catch (error) {
      console.error(`R2 upload failed: ${filePath}`, error instanceof Error ? error.message : String(error));
      skippedCount += 1;
    }
  }

  return {
    total: files.length,
    successCount,
    skippedCount
  };
}

async function main() {
  const bucket = requiredEnv("R2_BUCKET");
  const client = createR2Client();

  console.log("Starting full data backfill to R2...");

  const dataFiles = await backfillDataTree(client, bucket);

  console.log("");
  console.log("Backfill complete.");
  console.log(
    JSON.stringify(
      {
        dataFiles
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
