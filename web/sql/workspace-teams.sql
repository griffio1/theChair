-- Run after workspaces.sql and secure-team.sql, before deploying workspace-teams.
-- Preserve the original ledger; attribute only previously unscoped rows to its binding.
begin;
do $$
declare t text; home uuid;
begin
  select workspace_id into strict home from public.chair_legacy_binding;
  foreach t in array array['contracts','messages','conflicts','events','claims','extraction_cache'] loop
    execute format('alter table public.%I add column if not exists workspace_id uuid references public.chair_workspaces(id) on delete cascade',t);
    execute format('update public.%I set workspace_id=$1 where workspace_id is null',t) using home;
    execute format('alter table public.%I alter column workspace_id set not null',t);
    execute format('create index if not exists %I on public.%I(workspace_id)',t || '_workspace',t);
    if t <> 'extraction_cache' then
      execute format('drop policy if exists "team member read" on public.%I',t);
      execute format('drop policy if exists "team boundary" on public.%I',t);
      execute format('create policy "team member read" on public.%I for select to authenticated using (public.chair_is_member(workspace_id))',t);
      execute format('create policy "team boundary" on public.%I as restrictive for all to authenticated using (public.chair_is_member(workspace_id)) with check(false)',t);
    end if;
  end loop;
end;
$$;
alter table public.contracts drop constraint if exists contracts_pkey;
alter table public.contracts add primary key(workspace_id,id,version);
alter table public.extraction_cache drop constraint if exists extraction_cache_pkey;
alter table public.extraction_cache add primary key(workspace_id,sha,file);

-- Connections contain credentials: no direct browser access, even for owners.
create table if not exists public.chair_repository_connections (
  workspace_id uuid primary key references public.chair_workspaces(id) on delete cascade,
  repository_id bigint not null unique,
  repository text not null unique,
  token text not null,
  webhook_secret text not null,
  connected_by uuid not null references auth.users(id),
  connected_at timestamptz not null default now()
);
create or replace function public.chair_keep_repository_identity() returns trigger
language plpgsql set search_path = '' as $$ begin
  if new.repository_id <> old.repository_id then raise exception 'A workspace repository cannot be reassigned' using errcode='23505'; end if;
  return new;
end $$;
drop trigger if exists chair_repository_identity on public.chair_repository_connections;
create trigger chair_repository_identity before update on public.chair_repository_connections for each row execute function public.chair_keep_repository_identity();
alter table public.chair_repository_connections enable row level security;
revoke all on public.chair_repository_connections from public,anon,authenticated;
grant all on public.chair_repository_connections to service_role;

-- The earlier placeholder ledgers have never been wired to agents. Refuse a
-- silent replacement if a separate writer has populated them in the meantime.
do $$ begin
  if exists(select 1 from public.chair_contracts) or exists(select 1 from public.chair_conflicts) then
    raise exception 'Placeholder workspace ledgers contain data; reconcile them before this migration.';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
