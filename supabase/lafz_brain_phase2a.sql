create table if not exists kg_claims (
  id uuid primary key default gen_random_uuid(),
  claim_key text not null unique,
  claim_type text not null,
  scope_type text not null,
  scope_key text not null,
  normalized_key text not null,
  status text not null default 'proposed',
  confidence_score double precision not null default 0.5,
  source_count integer not null default 1,
  evidence_count integer not null default 0,
  payload_json jsonb not null default '{}'::jsonb,
  agent_session_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kg_claims_scope_idx on kg_claims (scope_type, scope_key);
create index if not exists kg_claims_type_status_idx on kg_claims (claim_type, status);
create index if not exists kg_claims_normalized_idx on kg_claims (normalized_key);
create index if not exists kg_claims_session_idx on kg_claims (agent_session_id);

create table if not exists kg_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references kg_claims(id) on delete cascade,
  source_type text not null,
  spotify_track_id text,
  artist_key text,
  line_order integer,
  weight double precision not null default 0.5,
  payload_json jsonb not null default '{}'::jsonb,
  agent_session_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists kg_evidence_claim_idx on kg_evidence (claim_id);
create index if not exists kg_evidence_track_idx on kg_evidence (spotify_track_id);
create index if not exists kg_evidence_artist_idx on kg_evidence (artist_key);
create index if not exists kg_evidence_session_idx on kg_evidence (agent_session_id);

create table if not exists kg_promotions (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references kg_claims(id) on delete cascade,
  decision text not null,
  promoted_node_id uuid references kg_nodes(id) on delete set null,
  promoted_edge_id uuid references kg_edges(id) on delete set null,
  reason text,
  decided_by text not null default 'phase2a',
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kg_promotions_claim_idx on kg_promotions (claim_id);
create index if not exists kg_promotions_decision_idx on kg_promotions (decision);
