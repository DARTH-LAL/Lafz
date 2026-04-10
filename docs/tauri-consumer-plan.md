# Tauri Consumer Test Plan

This plan keeps the main Lafz web app untouched and uses the Tauri consumer shell as a separate experiment lane.

## Goal

Build and test a desktop consumer experience that reads the operating system's active media session, shows Lafz translations, and sends play/pause/skip controls back through the OS when possible.

## Non-goals

- Do not change the main web app route or playback flow.
- Do not depend on the Spotify Web API in the Tauri test lane.
- Do not add iOS or Android work yet.
- Do not rework the translation pipeline just for this test.

## Test lane

- Tauri app entrypoint: `src-tauri/src/main.rs`
- Consumer route: `src/app/consumer/page.tsx`
- Consumer UI: `src/components/now-playing-client.tsx`
- Desktop dev runner: `scripts/run-desktop-dev.mjs`

## Build order

### 1. Keep the consumer shell isolated

- Leave the main web app on its existing routes.
- Keep `/consumer` as the only Tauri test surface.
- Keep the desktop shell pointed at the consumer route only.

### 2. Add a local media-session abstraction

- Introduce a small interface for "current playback state" in the Tauri lane.
- Start with a mock provider so the consumer UI can be exercised without any OS hook.
- Make the provider swap happen only in the Tauri path.

### 3. Add the macOS now-playing reader

- Implement a macOS adapter behind the abstraction.
- Read track title, artist, album art, progress, duration, and play state.
- Treat this as the first platform test target.

### 4. Wire Lafz translations to the current track

- Use the current track identity from the OS session to fetch the matching Lafz translation.
- Keep the translation display local to the Tauri consumer shell.
- Do not route through Spotify playback endpoints.

### 5. Add transport controls

- Map play/pause, next, previous, and seek through the OS session if supported.
- Keep the control UI inside the consumer route only.

## Test cases

- Launch the Tauri app with no music playing.
- Start playback in Spotify and verify Lafz detects the track change.
- Pause and resume and verify the UI updates quickly.
- Skip tracks and confirm the translation view follows the new track.
- Restart the Tauri app while music is playing and confirm it reconnects.
- Verify the main web app still behaves exactly as before.

## Acceptance criteria

- The main web app stays unchanged.
- The Tauri consumer shell shows the active track and translation without Spotify Web API calls.
- Playback state updates are fast enough to feel live.
- The consumer shell can be tested locally without affecting the rest of Lafz.

## Risk note

Apple's public docs clearly cover publishing Now Playing metadata and responding to remote commands from your own media app. Reading arbitrary third-party app playback on macOS is the part that needs the most care, so keep that adapter small and easy to replace if the OS behavior is different from the prototype.
