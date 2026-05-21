# Lafz

Lafz is a music translation platform that pairs playback detection with a translation library so listeners can follow songs in real time, understand slang and context, and keep the experience visually polished across web and desktop.

It started as a web prototype and now includes a consumer desktop shell built with Tauri. The project is designed around a simple idea: music is more powerful when the meaning moves with the song.

## The Idea

Lafz helps turn songs into something you can actually read along with.

- Detect the currently playing track from the system player or browser.
- Match that song against a translation library.
- Show synced translated lines when timing data exists.
- Fall back to a clean unsynced reading view when timing is missing.
- Keep the translation and playback experience lightweight, local-first, and easy to expand.

## What’s in this repo

This repository contains the full Lafz codebase:

- a Next.js web app
- a Tauri desktop app for macOS and Windows
- Supabase-backed data access and access control
- a translation drafting pipeline powered by multiple AI providers
- desktop packaging and update tooling
- Cloudflare R2 release publishing support

## Tech Stack

### Languages

- TypeScript
- JavaScript
- Rust
- SQL
- HTML / CSS

### Frameworks and Runtime

- Next.js
- React
- Tauri
- Node.js / npm

### Backend and Storage

- Supabase
- PostgreSQL
- Cloudflare R2

### Desktop / Native

- Rust-based Tauri shell
- macOS Automation / AppleScript
- Windows Media Session integration

### AI and Integrations

- OpenAI API
- Google Gemini API
- Anthropic API
- Spotify Web API / OAuth

### UI and Support Libraries

- Tailwind CSS
- `@supabase/supabase-js`
- `@tauri-apps/api`
- `react-force-graph`
- `three`
- `@aws-sdk/client-s3`

## Architecture

The project is split into a web layer, a desktop layer, and shared domain logic.

### Web app

The web app is the main product surface for translation browsing, library management, and AI-assisted drafting.

### Desktop app

The desktop client is a consumer-focused Tauri app that:

- reads the active song from the system player or browser
- looks up the song in Supabase
- renders synced or unsynced translations
- supports private beta access control
- supports update delivery through Cloudflare R2

### Shared logic

Most of the product logic lives in shared TypeScript modules so the same translation, matching, and formatting rules can be reused across surfaces.

## Repo Layout

```text
.
├── data/               # local translation, AI, and lyrics caches
├── desktop/            # standalone desktop UI
├── deploy/             # always-on deployment helpers
├── public/             # static assets
├── scripts/            # build and release scripts
├── src/                # Next.js app and shared domain code
├── src-tauri/          # Tauri desktop shell
├── supabase/           # database migrations and RPCs
└── README.md
```

## Desktop Packaging

Lafz ships a desktop build for beta and consumer testing.

- macOS users get a universal `.dmg`
- Windows users build from the same repo into a Windows installer
- desktop updates can be published to Cloudflare R2

## Getting Started

### Web app

```bash
npm install
npm run dev
```

Then open:

```text
http://127.0.0.1:3000
```

### Desktop app

```bash
npm run desktop:dev
```

### Desktop build

```bash
npm run desktop:app
```

## Why this stack works well for Lafz

- **Next.js + React** give the translation UI a fast, modern frontend.
- **Tauri + Rust** keep the desktop shell small and native-feeling.
- **Supabase + PostgreSQL** make the song and translation data easy to manage centrally.
- **Cloudflare R2** gives the desktop client a simple release/update channel.
- **OpenAI / Gemini / Anthropic** let Lafz draft and refine translations with multiple model perspectives.

## Current Focus

The project is focused on:

- matching songs accurately across players and browsers
- showing translations in the right synced or unsynced style
- making the desktop app feel consumer-ready
- keeping the translation library server-backed so it stays up to date
- shipping updates without forcing users to reinstall manually

## Notes

- This repo is intentionally built around music translation and playback sync, not audio downloading.
- Desktop access and update flows are handled separately from the main web app.
- The repo is actively evolving, so some build and deployment details may change as the consumer app hardens.
