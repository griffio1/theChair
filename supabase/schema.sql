-- AgentSync ledger schema (M3). Run in the Supabase SQL editor.

create table if not exists contracts (
  id text not null,
  version int not null,
  name text not null,
  method text not null,
  path text not null,
  request jsonb not null default '[]',
  response jsonb not null default '[]',
  status text not null check (status in ('proposed','approved','superseded')),
  owner text,
  notes text,
  proposed_by text,
  created_at timestamptz not null default now(),
  primary key (id, version)
);

create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  developer text not null,
  paths text[] not null,
  intent text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes'
);

create table if not exists conflicts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  severity text not null,
  summary text not null,
  contract_id text,
  affected_paths text[] not null default '{}',
  suggested_fix text,
  status text not null default 'open' check (status in ('open','approved','dismissed')),
  detected_by text not null,
  agent text,
  developer text,
  evidence jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  agent text,
  developer text,
  branch text,
  sha text,
  summary text not null,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  author_type text not null check (author_type in ('human','ai','system')),
  author_name text not null,
  kind text not null check (kind in ('text','contract_proposal','conflict','event')),
  body text not null,
  ref_id text,
  created_at timestamptz not null default now()
);

-- Cache Gemini extractions by commit SHA + file so the demo is repeatable.
create table if not exists extraction_cache (
  sha text not null,
  file text not null,
  shapes jsonb not null,
  created_at timestamptz not null default now(),
  primary key (sha, file)
);

-- The dashboard reads with the anon key: read-only for anon, writes go through the API (service key).
alter table contracts enable row level security;
alter table claims enable row level security;
alter table conflicts enable row level security;
alter table events enable row level security;
alter table messages enable row level security;
alter table extraction_cache enable row level security;
create policy "anon read" on contracts for select using (true);
create policy "anon read" on claims for select using (true);
create policy "anon read" on conflicts for select using (true);
create policy "anon read" on events for select using (true);
create policy "anon read" on messages for select using (true);

-- Seed the first approved contract (matches contracts/auth-login.json).
insert into contracts (id, version, name, method, path, request, response, status, owner, notes)
values ('auth-login', 1, 'Login', 'POST', '/api/auth/login',
  '[{"name":"email","type":"string","required":true},{"name":"password","type":"string","required":true}]',
  '[{"name":"userId","type":"string","required":true},{"name":"token","type":"string","required":true}]',
  'approved', 'parag', 'camelCase for all JSON fields.')
on conflict do nothing;

-- Live dashboard: enable Realtime on these tables.
alter publication supabase_realtime add table messages, conflicts, events, claims, contracts;
