alter table if exists public.published_translations
  add column if not exists canonical_title text,
  add column if not exists canonical_artist text,
  add column if not exists alternate_titles text[] not null default '{}'::text[],
  add column if not exists source_host text,
  add column if not exists match_confidence real not null default 1;

update public.published_translations
set
  canonical_title = coalesce(nullif(trim(canonical_title), ''), translation_json->>'title'),
  canonical_artist = coalesce(nullif(trim(canonical_artist), ''), translation_json->>'artist'),
  alternate_titles = coalesce(alternate_titles, '{}'::text[]),
  match_confidence = coalesce(match_confidence, 1)
where canonical_title is null
   or canonical_artist is null
   or alternate_titles is null
   or match_confidence is null;

create index if not exists published_translations_canonical_title_idx
  on public.published_translations (canonical_title);

create index if not exists published_translations_canonical_artist_idx
  on public.published_translations (canonical_artist);

create index if not exists published_translations_source_host_idx
  on public.published_translations (source_host);
