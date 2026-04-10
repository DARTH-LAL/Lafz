alter table if exists public.published_translations enable row level security;

drop policy if exists "Desktop consumer read published translations" on public.published_translations;

create policy "Desktop consumer read published translations"
  on public.published_translations
  for select
  to anon, authenticated
  using (true);

grant select on public.published_translations to anon, authenticated;
