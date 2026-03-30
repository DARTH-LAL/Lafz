import { readCloudDataJson, writeCloudDataJson, toCloudDataHint } from "@/features/cloud/data-store";
import type { LafzLibraryTrack } from "@/features/spotify/types";
import type { TranslationStubFile } from "@/features/translations/types";

export function getLocalTranslationFilePath(trackId: string) {
  return `data/translations/local/${trackId}.json`;
}

export function getTranslationStubFilePath(trackId: string) {
  return getLocalTranslationFilePath(trackId);
}

async function fileExists(filePath: string) {
  return (await readCloudDataJson<unknown>(filePath)) !== null;
}

export async function createTranslationStubFile(options: {
  spotifyTrackId: string;
  language: string | null;
  overwriteExistingStub: boolean;
}) {
  const filePath = getLocalTranslationFilePath(options.spotifyTrackId);
  const exists = await fileExists(filePath);

  // Preserve any local translation work unless the caller explicitly opts into overwriting stubs.
  if (exists && !options.overwriteExistingStub) {
    return {
      filePath: toCloudDataHint(filePath),
      created: false,
      overwritten: false,
      skipped: true
    };
  }

  const stub: TranslationStubFile = {
    spotify_track_id: options.spotifyTrackId,
    language: options.language,
    lines: []
  };

  await writeCloudDataJson(filePath, stub);

  return {
    filePath: toCloudDataHint(filePath),
    created: !exists,
    overwritten: exists,
    skipped: false
  };
}

export async function createTranslationStubsForTracks(
  tracks: LafzLibraryTrack[],
  options: { overwriteExistingStubs: boolean }
) {
  let createdCount = 0;
  let overwrittenCount = 0;
  let skippedCount = 0;

  for (const track of tracks) {
    const result = await createTranslationStubFile({
      spotifyTrackId: track.spotify_track_id,
      language: track.language,
      overwriteExistingStub: options.overwriteExistingStubs
    });

    if (result.overwritten) {
      overwrittenCount += 1;
    } else if (result.created) {
      createdCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  return {
    createdCount,
    overwrittenCount,
    skippedCount
  };
}
