import { deleteR2Object, getR2ObjectMetadata, listR2Keys, listR2Objects, readJsonFromR2, writeJsonToR2 } from "@/features/cloud/r2";
export { CloudStorageConfigurationError, isCloudStorageConfigurationError } from "@/features/cloud/r2";
export type { R2ObjectSummary as CloudDataObjectSummary } from "@/features/cloud/r2";

function normalizeRelativePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.startsWith("data/") ? normalized : `data/${normalized}`;
}

function normalizeDirectory(relativeDir: string) {
  const normalized = normalizeRelativePath(relativeDir);
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function toCloudDataKey(relativePath: string) {
  return normalizeRelativePath(relativePath);
}

export function toCloudDataHint(relativePath: string) {
  return `r2:${normalizeRelativePath(relativePath)}`;
}

export async function readCloudDataJson<T>(relativePath: string): Promise<T | null> {
  return readJsonFromR2<T>(normalizeRelativePath(relativePath));
}

export async function writeCloudDataJson(relativePath: string, value: unknown) {
  const key = normalizeRelativePath(relativePath);
  await writeJsonToR2(key, value);
  return toCloudDataHint(relativePath);
}

export async function deleteCloudDataJson(relativePath: string) {
  return deleteR2Object(normalizeRelativePath(relativePath));
}

export async function listCloudDataKeys(relativeDir: string) {
  return listR2Keys(normalizeDirectory(relativeDir));
}

export async function listCloudDataObjects(relativeDir: string) {
  return listR2Objects(normalizeDirectory(relativeDir));
}

export async function getCloudDataMetadata(relativePath: string) {
  return getR2ObjectMetadata(normalizeRelativePath(relativePath));
}

export function extractCloudFileName(key: string) {
  const normalized = key.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? normalized;
}
