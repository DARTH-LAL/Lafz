create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists kg_nodes (
  id uuid primary key default gen_random_uuid(),
  node_type text not null,
  canonical_key text not null,
  display_label text not null,
  aliases text[] not null default '{}',
  language_code text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  source_confidence text not null default 'ai_generated',
  is_active boolean not null default true,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (node_type, canonical_key)
);

create index if not exists kg_nodes_type_key_idx on kg_nodes (node_type, canonical_key);
create index if not exists kg_nodes_active_idx on kg_nodes (is_active);
create index if not exists kg_nodes_aliases_gin_idx on kg_nodes using gin (aliases);
create index if not exists kg_nodes_embedding_idx on kg_nodes using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table if not exists kg_edges (
  id uuid primary key default gen_random_uuid(),
  edge_key text not null unique,
  edge_type text not null,
  source_node_id uuid not null references kg_nodes(id) on delete cascade,
  target_node_id uuid not null references kg_nodes(id) on delete cascade,
  weight double precision not null default 0.5,
  metadata jsonb not null default '{}'::jsonb,
  source_song_id uuid references kg_nodes(id) on delete set null,
  evidence text,
  agent_session_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kg_edges_source_idx on kg_edges (source_node_id, edge_type);
create index if not exists kg_edges_target_idx on kg_edges (target_node_id, edge_type);
create index if not exists kg_edges_song_idx on kg_edges (source_song_id);

create table if not exists song_world_models (
  id uuid primary key default gen_random_uuid(),
  song_node_id uuid not null unique references kg_nodes(id) on delete cascade,
  spotify_track_id text not null unique,
  title text,
  artist text,
  artist_keys text[] not null default '{}',
  source_language text,
  summary text,
  speaker_persona text,
  addressee text,
  narrative_drive text,
  dominant_conflict text,
  world_state text,
  core_motifs text[] not null default '{}',
  recurring_symbols text[] not null default '{}',
  continuity_rules text[] not null default '{}',
  entities_json jsonb not null default '[]'::jsonb,
  relationships_json jsonb not null default '[]'::jsonb,
  verse_models_json jsonb not null default '[]'::jsonb,
  line_models_json jsonb not null default '[]'::jsonb,
  model_id text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists song_world_models_track_idx on song_world_models (spotify_track_id);
create index if not exists song_world_models_artist_keys_gin_idx on song_world_models using gin (artist_keys);

create table if not exists memory_pack_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  pack_type text not null default 'translation',
  scope_type text not null,
  scope_key text not null,
  payload_json jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create index if not exists memory_pack_cache_scope_idx on memory_pack_cache (scope_type, scope_key);

alter table artist_profiles
  add column if not exists kg_node_id uuid references kg_nodes(id) on delete set null;
