create extension if not exists pgcrypto;

create table if not exists public.lafz_song_votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  song_key text not null,
  spotify_track_id text,
  song_title text not null,
  song_artist text,
  song_album text,
  created_at timestamptz not null default now(),
  unique (user_id, song_key)
);

create index if not exists lafz_song_votes_song_key_idx
  on public.lafz_song_votes (song_key);

create index if not exists lafz_song_votes_created_at_idx
  on public.lafz_song_votes (created_at desc);

create index if not exists lafz_song_votes_user_id_idx
  on public.lafz_song_votes (user_id);

alter table public.lafz_song_votes enable row level security;

create or replace function public.cast_lafz_song_vote(
  p_song_key text,
  p_spotify_track_id text,
  p_song_title text,
  p_song_artist text,
  p_song_album text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_song_key text := nullif(trim(coalesce(p_song_key, '')), '');
  inserted_id uuid;
  total_votes bigint := 0;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if normalized_song_key is null then
    raise exception 'Song key is required';
  end if;

  insert into public.lafz_song_votes (
    user_id,
    song_key,
    spotify_track_id,
    song_title,
    song_artist,
    song_album
  )
  values (
    current_user_id,
    normalized_song_key,
    nullif(trim(coalesce(p_spotify_track_id, '')), ''),
    nullif(trim(coalesce(p_song_title, '')), ''),
    nullif(trim(coalesce(p_song_artist, '')), ''),
    nullif(trim(coalesce(p_song_album, '')), '')
  )
  on conflict (user_id, song_key) do nothing
  returning id into inserted_id;

  select count(*)
    into total_votes
  from public.lafz_song_votes
  where song_key = normalized_song_key;

  return jsonb_build_object(
    'created', inserted_id is not null,
    'hasVoted', true,
    'voteCount', total_votes,
    'songKey', normalized_song_key
  );
end;
$$;

grant execute on function public.cast_lafz_song_vote(text, text, text, text, text) to authenticated;

create or replace function public.remove_lafz_song_vote(
  p_song_key text,
  p_spotify_track_id text,
  p_song_title text,
  p_song_artist text,
  p_song_album text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_song_key text := nullif(trim(coalesce(p_song_key, '')), '');
  deleted_id uuid;
  total_votes bigint := 0;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if normalized_song_key is null then
    raise exception 'Song key is required';
  end if;

  delete from public.lafz_song_votes
  where user_id = current_user_id
    and song_key = normalized_song_key
  returning id into deleted_id;

  select count(*)
    into total_votes
  from public.lafz_song_votes
  where song_key = normalized_song_key;

  return jsonb_build_object(
    'removed', deleted_id is not null,
    'hasVoted', false,
    'voteCount', total_votes,
    'songKey', normalized_song_key
  );
end;
$$;

grant execute on function public.remove_lafz_song_vote(text, text, text, text, text) to authenticated;

create or replace function public.get_lafz_song_vote_summary(p_song_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_song_key text := nullif(trim(coalesce(p_song_key, '')), '');
  total_votes bigint := 0;
  user_voted boolean := false;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if normalized_song_key is null then
    raise exception 'Song key is required';
  end if;

  select count(*)
    into total_votes
  from public.lafz_song_votes
  where song_key = normalized_song_key;

  select exists (
    select 1
    from public.lafz_song_votes
    where song_key = normalized_song_key
      and user_id = current_user_id
  )
  into user_voted;

  return jsonb_build_object(
    'songKey', normalized_song_key,
    'voteCount', total_votes,
    'hasVoted', user_voted
  );
end;
$$;

grant execute on function public.get_lafz_song_vote_summary(text) to authenticated;

create or replace function public.list_lafz_song_vote_leaderboard(limit_count integer default 50)
returns table (
  song_key text,
  spotify_track_id text,
  song_title text,
  song_artist text,
  song_album text,
  vote_count bigint,
  last_voted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.lafz_current_user_is_admin() then
    raise exception 'Not authorized';
  end if;

  return query
    select
      votes.song_key,
      max(votes.spotify_track_id) as spotify_track_id,
      max(votes.song_title) as song_title,
      max(votes.song_artist) as song_artist,
      max(votes.song_album) as song_album,
      count(*)::bigint as vote_count,
      max(votes.created_at) as last_voted_at
    from public.lafz_song_votes votes
    group by votes.song_key
    order by count(*) desc, max(votes.created_at) desc, lower(max(votes.song_title)) asc
    limit greatest(1, coalesce(limit_count, 50));
end;
$$;

grant execute on function public.list_lafz_song_vote_leaderboard(integer) to authenticated;

notify pgrst, 'reload schema';
