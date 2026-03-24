# Lafz

Lafz is a web-first personal prototype that connects to your Spotify account, reads the currently playing track plus playback progress, and overlays your own local translated lyric data in sync with the song.

This repository is intentionally scoped as a personal prototype:

- It does not stream or download audio.
- It does not scrape lyrics websites.
- It only uses Spotify's official OAuth and Web API.
- It only reads and writes local JSON files that you control.
- It keeps copyright-sensitive lyric content out of git by ignoring `data/translations/local`.
- It keeps imported playlist library files local by ignoring `data/library/playlists`.

## Current feature set

- Spotify login/authentication
- Current playback polling from Spotify
- Track title, artist, album art, playback state, and progress display
- Local translation lookup by Spotify track ID
- Synced translated lyric rendering
- Active-line highlight
- Smooth auto-scroll to the active line
- Tap-to-expand line details for original text, transliteration, and notes
- Local Spotify playlist importer for building a translation work queue
- Single-song Spotify importer for pulling one track into the queue quickly
- Automatic local translation file creation for imported tracks
- Local translation queue aggregated across imported playlists
- Track detail view with translation JSON preview
- Local fallback import for `.lrc`, synced JSON, or plain lyrics text
- AI-assisted translation drafts from locally cached original lyrics
- Multi-pass AI translation pipeline with song context, artist memory, selector pass, low-confidence review, and correction memory
- Automatic synced playback when timed lyrics are available
- Plain reading mode when only untimed lyrics are available
- Clean loading, empty, and error states

## Architecture

The project keeps the reusable parts separated so the same core logic can later move into iPhone, Android, or React Native clients.

### Folder structure

```text
.
├── data/
│   ├── library/
│   │   └── playlists/            # imported playlist JSON files, ignored by git
│   ├── ai/
│   │   ├── glossaries/           # local glossary overrides + committed starter glossary samples
│   │   └── memory/               # optional artist-memory JSON for recurring tone/slang
│   ├── lyrics/
│   │   └── cache/                # locally imported lyrics cache, ignored by git
│   └── translations/
│       ├── drafts/               # AI-generated draft files, ignored by git
│       ├── local/                # your private translation files, ignored by git
│       └── samples/              # placeholder sample data committed to the repo
├── public/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── library/
│   │   │   │   ├── import-playlist/
│   │   │   │   └── import-track/
│   │   │   ├── lyrics/
│   │   │   ├── playback/
│   │   │   └── spotify/
│   │   ├── library/
│   │   │   ├── import/           # protected manual playlist + single-song import page
│   │   │   ├── queue/            # protected aggregated translation work queue
│   │   │   └── track/[spotifyTrackId]/
│   │   ├── login/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   ├── features/
│   │   ├── ai/                   # Ollama draft generation, provider status, local AI-draft repository
│   │   ├── library/              # queue aggregation, filtering, sorting
│   │   ├── lyrics/               # cache inspection, LRC parsing, and local import handling
│   │   ├── spotify/              # auth, playback, server-side playlist importer
│   │   ├── sync/                 # active-line engine + local playback clock
│   │   └── translations/         # JSON types, local translation file creation, inspection
│   └── lib/
├── .env.example
├── package.json
└── README.md
```

### File responsibilities

- `src/features/spotify/auth.ts`: builds the Spotify authorize URL and exchanges or refreshes tokens
- `src/features/spotify/session.ts`: stores tokens in secure HTTP-only cookies
- `src/features/spotify/playback.ts`: fetches and normalizes `/me/player`
- `src/features/spotify/playlist-import.ts`: validates playlist input, fetches playlist data, normalizes tracks, deduplicates, and writes local playlist JSON files
- `src/features/spotify/track-import.ts`: validates single-track input, fetches track metadata, and writes local single-song library JSON files
- `src/features/spotify/server-session.ts`: refreshes Spotify sessions for server routes
- `src/features/ai/openai.ts`: cloud-provider adapter for song-context generation, candidate drafting, refinement, and selector passes
- `src/features/ai/ollama.ts`: local-provider adapter for song-context generation, candidate drafting, refinement, and selector passes
- `src/features/ai/glossary.ts`: loads categorized glossary hints plus your own overrides for slang, idioms, phrases, and references
- `src/features/ai/artist-memory.ts`: loads optional artist-level translation memory for recurring tone and preferred renderings
- `src/features/ai/translation-draft.ts`: builds song context, grouped verse batches, refinement passes, and final selector output before writing synced or untimed draft files
- `src/features/ai/repository.ts`: stores and inspects local AI draft files
- `src/features/library/queue.ts`: reads imported playlist JSON files, deduplicates tracks, inspects translation files, and derives queue-ready status records
- `src/features/lyrics/repository.ts`: stores and inspects the local original-lyrics cache and imports local `.lrc` / JSON / plain text fallback content
- `src/features/lyrics/lrc.ts`: parses and formats LRC-style synced lyric timestamps
- `src/features/ai/correction-memory.ts`: learns from reviewed draft edits and stores preferred renderings in local track and artist memory files
- `src/features/translations/repository.ts`: loads local JSON by track ID and safely ignores empty placeholder files
- `src/features/translations/stubs.ts`: ensures local translation files exist without overwriting existing files
- `src/features/translations/inspection.ts`: inspects local translation files for existence, line count, preview JSON, and last-modified timestamps
- `src/features/sync/engine.ts`: finds the active line for a given `progressMs`
- `src/features/sync/use-playback-clock.ts`: keeps a lightweight client-side progress clock between polls
- `src/app/api/playback/route.ts`: returns the current playback snapshot plus matching local translation
- `src/app/api/library/import-playlist/route.ts`: runs the protected local playlist import
- `src/app/api/library/import-track/route.ts`: runs the protected local single-song import
- `src/app/api/ai/generate-translation/route.ts`: generates an AI translation draft from the cached original lyrics for a track
- `src/app/api/lyrics/import/route.ts`: imports local lyrics text as a fallback cache file for a track
- `src/app/library/import/page.tsx`: protected dev/admin page for manual playlist and single-song imports
- `src/app/library/queue/page.tsx`: protected aggregated queue for translation work
- `src/app/library/track/[spotifyTrackId]/page.tsx`: protected track detail view with JSON preview

## Auth approach

Lafz uses Spotify's server-side Authorization Code flow for the web prototype.

- Spotify sends the user back to `/api/spotify/callback` with an auth code.
- Lafz exchanges that code for access and refresh tokens on the server.
- Tokens are stored in HTTP-only cookies so the browser UI never gets raw Spotify secrets.
- The auth layer is isolated from playback and sync logic so it can be swapped for PKCE or a native auth flow later.

## Playback detection approach

The current MVP uses polling.

- The client polls `/api/playback` every 4 seconds.
- The API route refreshes the Spotify access token if needed.
- The API route calls Spotify `GET /me/player`.
- The response is normalized into a small playback object the UI can render.
- Between polls, the browser advances a lightweight local clock so active lyric highlighting feels live.

## Library importer

Lafz includes a protected manual import page at:

- `http://127.0.0.1:3000/library/import`

### Playlist import

You can paste either:

- a full Spotify playlist URL such as `https://open.spotify.com/playlist/...`
- a raw Spotify playlist ID
- a Spotify URI such as `spotify:playlist:...`

The playlist importer will:

1. extract the playlist ID
2. fetch playlist metadata from Spotify
3. page through playlist tracks until the full playlist is imported
4. skip local tracks, unsupported items, unavailable tracks, and duplicate Spotify track IDs
5. normalize imported tracks into Lafz library records
6. save the result to `data/library/playlists/<playlistId>.json`
7. automatically ensure `data/translations/local/<spotifyTrackId>.json` exists for every imported track

Important: for newly created Spotify Development Mode apps, playlist item access is currently limited. In Spotify's February 11, 2026 Development Mode update and migration guide, playlist item access is described as available only for playlists the user owns or collaborates on. If a public playlist from another account returns `403 Forbidden`, copy it into one of your own playlists first, then import that copy.

### Single-song import

You can also paste:

- a full Spotify track URL such as `https://open.spotify.com/track/...`
- a raw Spotify track ID
- a Spotify URI such as `spotify:track:...`

The single-song importer will:

1. extract the Spotify track ID
2. fetch the track metadata from Spotify
3. normalize that track into a Lafz library record
4. write a small local JSON file to `data/library/playlists/single-track-<spotifyTrackId>.json`
5. automatically ensure `data/translations/local/<spotifyTrackId>.json` exists

This keeps the queue logic unchanged because single-song imports still land in the same local library folder.

## Translation queue

Lafz includes a protected queue page at:

- `http://127.0.0.1:3000/library/queue`

The queue reads every local playlist file from:

- `data/library/playlists/*.json`

Then it:

1. flattens all playlist tracks into one combined queue
2. deduplicates songs by `spotify_track_id`
3. preserves every source playlist a song came from
4. inspects `data/translations/local/<spotifyTrackId>.json`
5. derives a practical UI status from the local translation file

### Queue status logic

- `pending`: no local translation file exists
- `stub` (`Needs lyrics` in the UI): translation file exists but `lines` is empty, or the file needs attention
- `translated`: translation file exists and contains at least one synced line

Lafz also keeps the library file's explicit `translation_status` field, but the queue UI prioritizes the practical file-based status above for daily translation work.

### Queue filters and sorting

The queue supports:

- search by title, artist, album, playlist name, or Spotify track ID
- filter by status
- filter by language
- filter by source playlist
- sort by title, artist, recently updated, or status

### Track detail page

Each queue item links to:

- `http://127.0.0.1:3000/library/track/<spotifyTrackId>`

The detail page shows:

- track metadata
- source playlists
- translation file presence and line count
- last modified time
- a JSON preview of the current local translation file
- guidance when a local translation file is unexpectedly missing

## Spotify developer setup

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Create a new app.
3. In the app settings, add this redirect URI for local development:
   - `http://127.0.0.1:3000/api/spotify/callback`
4. Save the settings.

Important: use `127.0.0.1`, not `localhost`, for the local redirect URI.

### Required scopes

Lafz currently requests these Spotify scopes:

- `user-read-playback-state`
- `user-read-currently-playing`
- `playlist-read-private`
- `playlist-read-collaborative`

Important: if you already signed into Lafz before the playlist importer was added, disconnect Spotify and reconnect once so the new playlist scopes are granted.

## Environment variables

Copy `.env.example` to `.env.local` and fill in your Spotify app credentials:

```bash
cp .env.example .env.local
```

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/spotify/callback
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5-mini
OPENAI_BASE_URL=https://api.openai.com/v1
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:14b
```

`OPENAI_API_KEY` is optional, but if you set it Lafz will prefer OpenAI for AI draft generation. `OPENAI_MODEL` and `OPENAI_BASE_URL` are optional and default to `gpt-5-mini` and `https://api.openai.com/v1`.

`OLLAMA_BASE_URL` and `OLLAMA_MODEL` are optional. If OpenAI is not configured, Lafz falls back to Ollama and defaults to `http://127.0.0.1:11434` and `qwen2.5:14b`.

## Translation files

Put your real translation files here:

- `data/translations/local/<spotifyTrackId>.json`

That directory is git-ignored so your own lyric data stays local.

A committed placeholder example lives here:

- `data/translations/samples/sample-track-id.json`

### Full translation JSON shape

```json
{
  "spotifyTrackId": "TRACK_ID_HERE",
  "title": "Song Title",
  "artist": "Artist Name",
  "sourceLanguage": "Punjabi",
  "targetLanguage": "English",
  "lines": [
    {
      "startMs": 0,
      "endMs": 4200,
      "original": "original lyric line",
      "translated": "translated line",
      "transliteration": "optional romanized line",
      "note": "optional slang or cultural meaning"
    }
  ]
}
```

### Auto-created local translation file shape

When playlist or single-song import brings a track into Lafz for the first time, Lafz automatically writes a minimal local translation file like this:

```json
{
  "spotify_track_id": "TRACK_ID_HERE",
  "language": "unknown",
  "lines": []
}
```

Lafz intentionally treats these empty files as placeholders, not as finished synced translations.

## Original lyrics sources

### Local lyrics import

Paste local lyrics content on the track detail page to create the original-lyrics cache for a song.

Supported input:

- `.lrc` timed lyrics
- synced lyric JSON with `lines`
- plain lyric text

That local fallback is also stored here:

- `data/lyrics/cache/<spotifyTrackId>.json`

The lyrics cache is git-ignored so imported original lyrics do not end up in the repo by default.

## AI translation drafts

Once a track has original lyrics cached, the track detail page can generate an AI-assisted translation draft.

### AI draft flow

1. Lafz reads the cached original lyrics from `data/lyrics/cache/<spotifyTrackId>.json`.
2. Lafz loads any matching glossary hints for the detected language from `data/ai/glossaries`.
3. If `OPENAI_API_KEY` is set, Lafz sends the lyric lines to OpenAI first. Otherwise it falls back to your local Ollama server.
4. Lafz builds a song-level context summary first so later passes can stay consistent about tone, themes, and recurring phrases.
5. Lafz loads any matching artist memory from `data/ai/memory/artists`.
6. Lafz generates a grouped first-pass draft so nearby verse lines can help disambiguate each other.
7. Lafz runs a refinement pass for consistency and slang accuracy across the lyric candidates.
8. Lafz runs a selector pass that chooses the safest final display line from the literal, natural, and slang-aware candidates.
9. Lafz saves the generated result locally to:
   - `data/translations/drafts/<spotifyTrackId>.json`
   - the draft is reviewed on the same track page; Lafz does not bounce you back to now-playing after a successful generation
10. If the cached lyrics are synced, Lafz can also write a playback-ready translation file to:
   - `data/translations/local/<spotifyTrackId>.json`
11. If the cached lyrics are plain and untimed, Lafz keeps the AI result as a draft only so your synced translation file is not polluted with fake timestamps.
12. Untimed drafts still appear on the now-playing screen in a plain reading mode, even though they are not karaoke-style synced yet.

### Local glossary hints

Lafz includes a small starter glossary for common romanized Punjabi lyric terms, and you can add your own local overrides here:

- `data/ai/glossaries/local/common.json`
- `data/ai/glossaries/local/punjabi.json`
- `data/ai/glossaries/local/hindi.json`
- `data/ai/glossaries/local/urdu.json`
- `data/ai/glossaries/local/artists/<artist-name>.json`
- `data/ai/glossaries/local/tracks/<spotifyTrackId>.json`

Each file can be either a simple array of entries or a categorized object:

```json
[
  {
    "term": "jatta",
    "meaning": "jatt / bro / young man",
    "note": "Vocative address for a man."
  }
]
```

```json
{
  "slang": [
    {
      "term": "jatta",
      "meaning": "used to address a Jatt man; often carries swagger or pride",
      "note": "Usually better treated as a vocative than translated literally."
    }
  ],
  "idioms": [
    {
      "term": "teri meri da ni hunda",
      "meaning": "there is no yours and mine",
      "note": "Used to express non-possessive loyalty or friendship."
    }
  ],
  "preferredRenderings": [
    {
      "term": "yaari",
      "meaning": "loyal friendship"
    }
  ]
}
```

Local glossary files are git-ignored so you can keep refining them as the AI learns your preferred interpretations for slang, idioms, and recurring artist vocabulary.

### Artist memory

If an artist keeps using the same tone, references, or preferred English renderings, you can add an optional memory file at:

- `data/ai/memory/artists/<artist-name>.json`

Example:

```json
{
  "displayName": "Karan Aujla",
  "translationPreferences": [
    "Keep flex lines sharp and restrained instead of over-poetic.",
    "Prefer conservative translations when a threat or boast could be read two ways."
  ],
  "recurringThemes": ["status", "loyalty", "swagger", "competition"],
  "toneNotes": ["cool confidence", "dry flex", "less melodrama"],
  "notes": ["Do not over-explain references unless the line is genuinely unclear."],
  "preferredRenderings": [
    {
      "term": "yaari",
      "meaning": "loyal friendship"
    }
  ]
}
```

Lafz blends this memory into the song-context, refinement, and selector passes so line choices stay more consistent across the same artist.

### AI draft overwrite rules

- If the current translation file is missing or still just a stub, Lafz can replace it with the synced AI draft automatically.
- If the current translation file already has translated lines, Lafz preserves it unless you explicitly enable overwrite on the track page.
- AI drafts are always saved separately first, even when a synced translation file is also written.

### OpenAI setup

If you want the higher-quality hosted AI path:

1. Create an API key in the [OpenAI Platform](https://platform.openai.com/api-keys)
2. Add it to `.env.local`:
   - `OPENAI_API_KEY=...`
3. Optionally choose a model:
   - `OPENAI_MODEL=gpt-5-mini`

Lafz uses OpenAI automatically whenever `OPENAI_API_KEY` is present.

### Ollama setup

For the local AI path, install and run Ollama on your Mac:

1. Install Ollama: [https://ollama.com/download](https://ollama.com/download)
2. Start the Ollama app, or run:
   - `ollama serve`
3. Pull the model Lafz is configured to use:
   - `ollama pull qwen2.5:14b`

`qwen2.5:14b` is the recommended local model for Lafz on a modern Apple Silicon laptop if you want the best draft quality without using a paid cloud API. If you need a lighter, faster fallback, `qwen2.5:7b` is the next best option.

If you set a different `OLLAMA_MODEL` in `.env.local`, pull that model name instead.

### Example AI draft JSON shape

```json
{
  "spotifyTrackId": "TRACK_ID_HERE",
  "title": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "durationMs": 201320,
  "sourceLanguage": "Punjabi",
  "targetLanguage": "English",
  "generatedAt": "2026-03-21T13:15:00.000Z",
  "mode": "synced",
  "sourceLyricsKind": "synced",
  "generator": {
    "provider": "ollama",
    "model": "qwen2.5:14b"
  },
  "lines": [
    {
      "order": 0,
      "original": "original lyric line",
      "literal": "close meaning in English",
      "natural": "clean natural English line",
      "chosen": "the default line Lafz should display",
      "translated": "same as chosen for backward compatibility",
      "transliteration": "optional romanized line",
      "note": "optional slang or cultural meaning",
      "ambiguity": "optional note when the line has multiple plausible readings",
      "confidence": "medium",
      "startMs": 0,
      "endMs": 4200
    }
  ]
}
```

## Playlist library output

Imported playlists are written here:

- `data/library/playlists/<playlistId>.json`

### Example playlist output JSON shape

```json
{
  "source": "spotify",
  "playlist_id": "37i9dQZF1DXcBWIGoYBM5M",
  "playlist_name": "Today's Top Hits",
  "playlist_url": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
  "owner_display_name": "Spotify",
  "imported_at": "2026-03-21T12:00:00.000Z",
  "total_tracks_fetched": 50,
  "imported_track_count": 47,
  "skipped_track_count": 3,
  "tracks": [
    {
      "spotify_track_id": "4iV5W9uYEdYUVa79Axb7Rh",
      "title": "Example Song",
      "artist": "Example Artist",
      "album": "Example Album",
      "duration_ms": 201320,
      "source_playlist_id": "37i9dQZF1DXcBWIGoYBM5M",
      "source_playlist_name": "Today's Top Hits",
      "language": "unknown",
      "translation_status": "pending",
      "spotify_track_url": "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh"
    }
  ]
}
```

### Example derived queue record shape

```json
{
  "spotify_track_id": "4iV5W9uYEdYUVa79Axb7Rh",
  "title": "Example Song",
  "artist": "Example Artist",
  "album": "Example Album",
  "duration_ms": 201320,
  "source_playlists": [
    {
      "playlist_id": "37i9dQZF1DXcBWIGoYBM5M",
      "playlist_name": "Today's Top Hits",
      "playlist_url": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
    }
  ],
  "language": "Punjabi",
  "explicit_translation_status": "pending",
  "derived_status": "stub",
  "translation_file_exists": true,
  "translation_file_path": "/absolute/path/to/data/translations/local/4iV5W9uYEdYUVa79Axb7Rh.json",
  "translation_line_count": 0,
  "translation_last_modified_at": "2026-03-21T12:10:00.000Z",
  "translation_parse_error": null,
  "spotify_track_url": "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh"
}
```

## Running locally

### Prerequisites

- Node.js 20+
- npm
- A Spotify account with an active playback session on one of your devices

### Install and start

```bash
npm install
npm run dev
```

Open:

- login: [http://127.0.0.1:3000/login](http://127.0.0.1:3000/login)
- now playing: [http://127.0.0.1:3000/](http://127.0.0.1:3000/)
- library importer: [http://127.0.0.1:3000/library/import](http://127.0.0.1:3000/library/import)
- translation queue: [http://127.0.0.1:3000/library/queue](http://127.0.0.1:3000/library/queue)

## Testing the importer with real Spotify data

### Playlist test

1. Start Lafz locally with `npm run dev`.
2. Sign into Spotify at `/login`.
3. If you signed in before the playlist scopes were added, disconnect and reconnect once.
4. Open `/library/import`.
5. Paste a Spotify playlist URL or playlist ID.
6. Submit the import.
7. Confirm that Lafz creates:
   - `data/library/playlists/<playlistId>.json`
   - `data/translations/local/<spotifyTrackId>.json`
8. Open one of the generated files and begin filling in your own translation data.

### Single-song test

1. Open `/library/import`.
2. Paste a Spotify track URL or track ID into the single-song import form.
3. Submit the import.
4. Confirm that Lafz creates:
   - `data/library/playlists/single-track-<spotifyTrackId>.json`
   - `data/translations/local/<spotifyTrackId>.json`
5. Open `/library/queue` and confirm the song appears there immediately.

## Testing the translation queue

1. Import one or more playlists from `/library/import`.
2. Open `/library/queue`.
3. Confirm the page shows a deduplicated combined list of imported tracks.
4. Use the status filter to switch between `pending`, `Needs lyrics`, and `translated`.
5. Use the language and playlist filters to narrow the queue.
6. Open a track detail page from the queue.
7. Confirm the track already has `data/translations/local/<spotifyTrackId>.json` after import.
8. Add one or more synced lines to that JSON file and refresh the queue.
9. Confirm the track moves from `Needs lyrics` to `translated` once `lines` contains at least one item.

## Testing AI drafts

1. Install and start Ollama locally.
2. Pull the model Lafz should use, for example:
   - `ollama pull llama3.2`
3. Restart Lafz with `npm run dev`.
4. Open `/library/queue`.
5. Open a track detail page.
6. Import local lyrics first.
7. In the `AI translation draft` section, choose the source and target languages.
8. Optionally keep transliteration and note generation enabled.
9. Click `Generate AI draft`.
10. Confirm Lafz creates:
   - `data/translations/drafts/<spotifyTrackId>.json`
11. If the original lyrics cache was synced, confirm Lafz also updates:
   - `data/translations/local/<spotifyTrackId>.json`
12. Confirm the track page now shows:
   - song context
   - low-confidence lines first
   - literal, natural, and slang-aware candidates
13. Save any review edits directly on the same page.

## How the sync logic works

1. The browser signs in through Spotify.
2. Lafz saves Spotify tokens in HTTP-only cookies.
3. The browser polls `/api/playback`.
4. The server refreshes tokens when needed and calls Spotify `/me/player`.
5. The server looks for a matching local translation JSON file by track ID.
6. The browser predicts progress between polls with a lightweight local timer.
7. The sync engine picks the active line for the current `progressMs`.
8. The UI highlights the active line and auto-scrolls it into view.

## Notes about private data

- `data/translations/local` is ignored by git so your own lyric translations stay local by default.
- `data/library/playlists` is ignored by git so imported playlist libraries stay local by default.
- Only placeholder sample data is committed in this repo.
- If you later add admin uploads or a shared database, keep that as a separate layer rather than storing copyrighted material in the public repo.

## Assumptions in the current importer

- The importer supports Spotify playlists plus single-track imports.
- Local playlist files and unavailable tracks are skipped instead of being forced into the library.
- Duplicate Spotify track IDs are deduplicated within a playlist import.
- Duplicate Spotify track IDs are deduplicated again across all imported playlist files when building the queue.
- Empty auto-created translation files are treated as placeholders and not as synced translation files.
- The queue treats malformed translation JSON as needing attention and keeps going instead of crashing the whole page.
- Existing translation files are preserved automatically during import.

## Future-ready extension points

This structure is meant to support later additions such as:

- Apple Music support via another playback adapter
- saved songs and favorites
- deeper line-by-line meaning views
- admin-uploaded translation sources
- React Native or native mobile clients reusing the sync and translation logic
