create table if not exists public.lafz_app_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  can_access_lafz boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_seen_country text,
  last_seen_city text
);

alter table public.lafz_app_profiles
  add column if not exists is_admin boolean not null default false;

alter table public.lafz_app_profiles
  add column if not exists last_seen_country text,
  add column if not exists last_seen_city text;

create table if not exists public.lafz_desktop_invites (
  email text primary key,
  can_access_lafz boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lafz_desktop_invites enable row level security;

alter table public.lafz_app_profiles enable row level security;

drop policy if exists "Users can read their own Lafz profile" on public.lafz_app_profiles;
create policy "Users can read their own Lafz profile"
  on public.lafz_app_profiles
  for select
  to authenticated
  using (auth.uid() = id);

create or replace function public.lafz_current_user_is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lafz_app_profiles profile
    where profile.id = auth.uid()
      and profile.is_admin = true
  );
$$;

grant execute on function public.lafz_current_user_is_admin() to authenticated;

create or replace function public.set_lafz_display_name(display_name text)
returns public.lafz_app_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.lafz_app_profiles;
  invite_access boolean;
  cleaned_name text := nullif(trim(coalesce(display_name, '')), '');
  user_email text := '';
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select lower(coalesce(email, ''))
    into user_email
  from auth.users
  where id = auth.uid();

  insert into public.lafz_app_profiles (id, email, display_name, last_seen_at)
  select
    u.id,
    lower(coalesce(u.email, '')),
    cleaned_name,
    now()
  from auth.users u
  where u.id = auth.uid()
  on conflict (id) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        last_seen_at = now(),
        updated_at = now()
  returning * into updated_row;

  select invite.can_access_lafz
    into invite_access
  from public.lafz_desktop_invites invite
  where lower(invite.email) = user_email
  order by invite.updated_at desc
  limit 1;

  if invite_access is not null then
    update public.lafz_app_profiles
    set can_access_lafz = invite_access,
        updated_at = now()
    where id = updated_row.id
    returning * into updated_row;
  end if;

  return updated_row;
end;
$$;

grant execute on function public.set_lafz_display_name(text) to authenticated;

create or replace function public.touch_lafz_last_seen(
  p_last_seen_country text default null,
  p_last_seen_city text default null
)
returns public.lafz_app_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.lafz_app_profiles;
  cleaned_country text := nullif(trim(coalesce(p_last_seen_country, '')), '');
  cleaned_city text := nullif(trim(coalesce(p_last_seen_city, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.lafz_app_profiles (
    id,
    email,
    last_seen_at,
    last_seen_country,
    last_seen_city
  )
  select
    u.id,
    lower(coalesce(u.email, '')),
    now(),
    cleaned_country,
    cleaned_city
  from auth.users u
  where u.id = auth.uid()
  on conflict (id) do update
    set email = excluded.email,
        last_seen_at = now(),
        last_seen_country = coalesce(excluded.last_seen_country, public.lafz_app_profiles.last_seen_country),
        last_seen_city = coalesce(excluded.last_seen_city, public.lafz_app_profiles.last_seen_city),
        updated_at = now()
  returning * into updated_row;

  return updated_row;
end;
$$;

grant execute on function public.touch_lafz_last_seen(text, text) to authenticated;

create or replace function public.handle_new_lafz_app_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_access boolean;
begin
  insert into public.lafz_app_profiles (id, email, display_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  select invite.can_access_lafz
    into invite_access
  from public.lafz_desktop_invites invite
  where lower(invite.email) = lower(coalesce(new.email, ''))
  order by invite.updated_at desc
  limit 1;

  if invite_access is not null then
    update public.lafz_app_profiles
    set can_access_lafz = invite_access,
        updated_at = now()
    where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_lafz_app_user();

create or replace function public.list_lafz_admin_access_targets()
returns table (
  email text,
  display_name text,
  can_access_lafz boolean,
  is_admin boolean,
  has_profile boolean,
  created_at timestamptz,
  updated_at timestamptz,
  last_seen_at timestamptz,
  last_seen_country text,
  last_seen_city text,
  invite_created_at timestamptz,
  invite_updated_at timestamptz
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
      coalesce(profile.email, invite.email) as email,
      coalesce(profile.display_name, '') as display_name,
      case
        when invite.email is not null then invite.can_access_lafz
        else coalesce(profile.can_access_lafz, false)
      end as can_access_lafz,
      coalesce(profile.is_admin, false) as is_admin,
      profile.id is not null as has_profile,
      profile.created_at,
      profile.updated_at,
      profile.last_seen_at,
      profile.last_seen_country,
      profile.last_seen_city,
      invite.created_at as invite_created_at,
      invite.updated_at as invite_updated_at
    from public.lafz_desktop_invites invite
    full outer join public.lafz_app_profiles profile
      on lower(profile.email) = lower(invite.email)
    order by
      coalesce(profile.updated_at, invite.updated_at, profile.created_at, invite.created_at) desc nulls last,
      lower(coalesce(profile.email, invite.email)) asc;
end;
$$;

grant execute on function public.list_lafz_admin_access_targets() to authenticated;

create or replace function public.set_lafz_access_by_email(target_email text, can_access boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(nullif(trim(coalesce(target_email, '')), ''));
  invite_row public.lafz_desktop_invites%rowtype;
  updated_count integer := 0;
begin
  if not public.lafz_current_user_is_admin() then
    raise exception 'Not authorized';
  end if;

  if normalized_email is null then
    raise exception 'Email is required';
  end if;

  insert into public.lafz_desktop_invites (email, can_access_lafz, updated_at)
  values (normalized_email, can_access, now())
  on conflict (email) do update
    set can_access_lafz = excluded.can_access_lafz,
        updated_at = now()
  returning * into invite_row;

  update public.lafz_app_profiles
  set can_access_lafz = invite_row.can_access_lafz,
      updated_at = now()
  where lower(email) = normalized_email;

  get diagnostics updated_count = row_count;

  return jsonb_build_object(
    'email', normalized_email,
    'canAccessLafz', invite_row.can_access_lafz,
    'profileFound', updated_count > 0,
    'updatedProfiles', updated_count
  );
end;
$$;

grant execute on function public.set_lafz_access_by_email(text, boolean) to authenticated;

alter table public.published_translations enable row level security;

drop policy if exists "Desktop consumer read published translations" on public.published_translations;
drop policy if exists "Desktop consumer read published translations (authenticated)" on public.published_translations;
drop policy if exists "Authenticated Lafz accounts can read published translations" on public.published_translations;

create policy "Authenticated Lafz accounts can read published translations"
  on public.published_translations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.lafz_app_profiles profile
      where profile.id = auth.uid()
        and profile.can_access_lafz = true
    )
  );
