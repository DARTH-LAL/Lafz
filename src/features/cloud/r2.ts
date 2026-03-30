import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

let cachedR2Client: S3Client | null = null;

export class CloudStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudStorageConfigurationError";
  }
}

export function isCloudStorageConfigurationError(error: unknown): error is CloudStorageConfigurationError {
  return error instanceof CloudStorageConfigurationError || (typeof error === "object" && error !== null && "name" in error && error.name === "CloudStorageConfigurationError");
}

function readR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() ?? "";
  const bucket = process.env.R2_BUCKET?.trim() ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "";

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey
  };
}

function getRequiredR2Config() {
  const config = readR2Config();

  if (!config) {
    throw new CloudStorageConfigurationError(
      "Cloudflare R2 is not fully configured. Set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY."
    );
  }

  return config;
}

function getR2Client() {
  if (cachedR2Client) {
    return cachedR2Client;
  }

  const config = getRequiredR2Config();

  cachedR2Client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  return cachedR2Client;
}

function getBucket() {
  return getRequiredR2Config().bucket;
}

export function isR2Configured() {
  return readR2Config() !== null;
}

export async function writeJsonToR2(key: string, value: unknown) {
  const client = getR2Client();
  const bucket = getBucket();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: `${JSON.stringify(value, null, 2)}\n`,
      ContentType: "application/json; charset=utf-8"
    })
  );

  return true;
}

export async function readJsonFromR2<T>(key: string): Promise<T | null> {
  const client = getR2Client();
  const bucket = getBucket();

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );

    const raw = await response.Body?.transformToString();

    if (!raw) {
      return null;
    }

  return JSON.parse(raw) as T;
  } catch (error) {
    if (error && typeof error === "object" && "name" in error) {
      const name = String(error.name);
      if (name === "NoSuchKey" || name === "NotFound") {
        return null;
      }
    }

    throw error;
  }
}

export type R2ObjectSummary = {
  key: string;
  lastModifiedAt: string | null;
  contentLength: number | null;
  eTag: string | null;
};

export async function listR2Objects(prefix: string): Promise<R2ObjectSummary[]> {
  const client = getR2Client();
  const bucket = getBucket();

  const objects: R2ObjectSummary[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );

    for (const item of response.Contents ?? []) {
      if (item.Key) {
        objects.push({
          key: item.Key,
          lastModifiedAt: item.LastModified?.toISOString() ?? null,
          contentLength: typeof item.Size === "number" ? item.Size : null,
          eTag: typeof item.ETag === "string" ? item.ETag : null
        });
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

export async function listR2Keys(prefix: string) {
  return (await listR2Objects(prefix)).map((item) => item.key);
}

export async function getR2ObjectMetadata(key: string): Promise<{
  lastModifiedAt: string | null;
  contentLength: number | null;
  eTag: string | null;
} | null> {
  const client = getR2Client();
  const bucket = getBucket();

  try {
    const response = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );

    return {
      lastModifiedAt: response.LastModified?.toISOString() ?? null,
      contentLength: typeof response.ContentLength === "number" ? response.ContentLength : null,
      eTag: typeof response.ETag === "string" ? response.ETag : null
    };
  } catch (error) {
    if (error && typeof error === "object" && "name" in error) {
      const name = String(error.name);
      if (name === "NoSuchKey" || name === "NotFound") {
        return null;
      }
    }

    throw error;
  }
}

export async function deleteR2Object(key: string) {
  const client = getR2Client();
  const bucket = getBucket();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );

  return true;
}
