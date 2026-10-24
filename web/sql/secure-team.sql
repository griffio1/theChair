-- Protect the original single-repository ledger and attach it to Carter's Test67.
-- Run AFTER workspaces.sql. No messages, contracts or conflicts are deleted/copied.
begin;

create table if not exists public.chair_legacy_binding (
  singleton boolean primary key default true check (singleton),
  workspace_id uuid not null unique references public.chair_workspaces(id)
);
alter table public.chair_legacy_binding enable row level security;
revoke all on public.chair_legacy_binding from public, anon, authenticated;
grant select on public.chair_legacy_binding to authenticated;
grant all on public.chair_legacy_binding to service_role;
drop policy if exists "team members see binding" on public.chair_legacy_binding;
create policy "team members see binding" on public.chair_legacy_binding for select to authenticated
  using (public.chair_is_member(workspace_id));

-- Explicitly approved destination. Never automatically assign old data to the
-- first account that signs up or the first workspace a client supplies.
do $$
declare target uuid := 'cb57bef0-6a3d-4967-a0e2-4dc2982f78ff';
begin
  if not exists(select 1 from public.chair_workspaces where id = target) then
    raise exception 'Approved Test67 workspace does not exist. Stop and confirm the destination.';
  end if;
  if exists(select 1 from public.chair_legacy_binding where workspace_id <> target) then
    raise exception 'The ledger is already assigned elsewhere. Do not reassign automatically.';
  end if;
  insert into public.chair_legacy_binding(singleton,workspace_id) values (true,target) on conflict do nothing;
end;
$$;

create or replace function public.chair_has_legacy_access() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.chair_legacy_binding b
    join public.chair_memberships m on m.workspace_id=b.workspace_id
    where m.user_id=auth.uid());
$$;
revoke all on function public.chair_has_legacy_access() from public, anon;
grant execute on function public.chair_has_legacy_access() to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['contracts','messages','conflicts','events','claims'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
    execute format('drop policy if exists "anon read" on public.%I',table_name);
    execute format('drop policy if exists "team member read" on public.%I',table_name);
    execute format('drop policy if exists "team boundary" on public.%I',table_name);
    execute format('create policy "team member read" on public.%I for select to authenticated using (public.chair_has_legacy_access())',table_name);
    -- Also restrict any independently added permissive policy.
    execute format('create policy "team boundary" on public.%I as restrictive for all to authenticated using (public.chair_has_legacy_access()) with check (false)',table_name);
  end loop;
end;
$$;
alter table public.extraction_cache enable row level security;
revoke all on public.extraction_cache from public, anon, authenticated;
grant all on public.extraction_cache to service_role;

-- Agent credentials are scoped to this binding, expire, and cannot approve fixes.
-- Raw credentials stay in ignored env/config files. Only hashes are stored here.
create table if not exists public.chair_agent_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  issued_by uuid not null references auth.users(id) on delete cascade,
  label text not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.chair_agent_credentials enable row level security;
revoke all on public.chair_agent_credentials from public, anon, authenticated;
grant all on public.chair_agent_credentials to service_role;
notify pgrst, 'reload schema';
commit;
