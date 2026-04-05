create table if not exists kg_learning_profiles (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null,
  claim_type text not null,
  normalized_key text not null,
  signal_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  deferred_count integer not null default 0,
  manual_override_count integer not null default 0,
  confidence_bias double precision not null default 0,
  last_decision text,
  last_decided_by text,
  last_claim_id uuid references kg_claims(id) on delete set null,
  last_decision_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_type, claim_type, normalized_key)
);

create index if not exists kg_learning_profiles_scope_idx on kg_learning_profiles (scope_type, claim_type, normalized_key);
create index if not exists kg_learning_profiles_bias_idx on kg_learning_profiles (confidence_bias desc, updated_at desc);
