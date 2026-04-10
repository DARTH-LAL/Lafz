alter table if exists public.published_translations
  add column if not exists album_art_url text;

create index if not exists published_translations_album_art_url_idx
  on public.published_translations (spotify_track_id, album_art_url);

