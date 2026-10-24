-- Additive workspace storage. Run once in the Supabase SQL editor as postgres.
-- Existing demo/ledger tables and policies are not changed or copied.
begin;

create table if not exists public.chair_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.chair_memberships (
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists chair_memberships_user on public.chair_memberships(user_id);
create table if not exists public.chair_chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create table if not exists public.chair_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  chat_id uuid not null,
  author_id uuid not null references auth.users(id),
  author_name text not null,
  body text not null check (length(btrim(body)) between 1 and 10000),
  client_message_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, chat_id) references public.chair_chats(workspace_id, id) on delete cascade,
  unique (chat_id, author_id, client_message_id)
);
create index if not exists chair_messages_chat_time on public.chair_messages(chat_id, created_at, id);
create table if not exists public.chair_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  email text not null check (length(email) <= 254 and email = lower(btrim(email))),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists chair_invitation_pending on public.chair_invitations(workspace_id, email) where accepted_at is null;

-- Separate scoped ledger; no global contracts/conflicts leak into new workspaces.
-- Writes are reserved for the workspace-aware agent integration, not browsers.
create table if not exists public.chair_contracts (
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  id text not null,
  version integer not null,
  contract jsonb not null,
  primary key (workspace_id, id, version)
);
create table if not exists public.chair_conflicts (
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  conflict jsonb not null,
  primary key (workspace_id, id)
);

-- Small SECURITY DEFINER helpers avoid recursive membership RLS queries.
-- Every function pins search_path and schema-qualifies relations.
create or replace function public.chair_is_member(p_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.chair_memberships where workspace_id = p_workspace and user_id = auth.uid());
$$;
create or replace function public.chair_is_owner(p_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.chair_memberships where workspace_id = p_workspace and user_id = auth.uid() and role = 'owner');
$$;

alter table public.chair_workspaces enable row level security;
alter table public.chair_memberships enable row level security;
alter table public.chair_chats enable row level security;
alter table public.chair_messages enable row level security;
alter table public.chair_invitations enable row level security;
alter table public.chair_contracts enable row level security;
alter table public.chair_conflicts enable row level security;

drop policy if exists chair_workspace_read on public.chair_workspaces;
create policy chair_workspace_read on public.chair_workspaces for select to authenticated using (public.chair_is_member(id));
drop policy if exists chair_member_read on public.chair_memberships;
create policy chair_member_read on public.chair_memberships for select to authenticated using (public.chair_is_member(workspace_id));
drop policy if exists chair_chat_read on public.chair_chats;
create policy chair_chat_read on public.chair_chats for select to authenticated using (public.chair_is_member(workspace_id));
drop policy if exists chair_message_read on public.chair_messages;
create policy chair_message_read on public.chair_messages for select to authenticated using (public.chair_is_member(workspace_id));
drop policy if exists chair_invitation_read on public.chair_invitations;
create policy chair_invitation_read on public.chair_invitations for select to authenticated using (public.chair_is_owner(workspace_id));
drop policy if exists chair_contract_read on public.chair_contracts;
create policy chair_contract_read on public.chair_contracts for select to authenticated using (public.chair_is_member(workspace_id));
drop policy if exists chair_conflict_read on public.chair_conflicts;
create policy chair_conflict_read on public.chair_conflicts for select to authenticated using (public.chair_is_member(workspace_id));

revoke all on public.chair_workspaces, public.chair_memberships, public.chair_chats, public.chair_messages, public.chair_invitations, public.chair_contracts, public.chair_conflicts from anon, authenticated;
grant select on public.chair_workspaces, public.chair_memberships, public.chair_chats, public.chair_messages, public.chair_contracts, public.chair_conflicts to authenticated;
-- Do not expose token hashes, even to owners via the REST table endpoint.
grant select (id, workspace_id, email, expires_at, accepted_at, created_at) on public.chair_invitations to authenticated;

create or replace function public.chair_create_workspace(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.chair_workspaces; c public.chair_chats; display text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'Invalid workspace name' using errcode = '22023'; end if;
  select coalesce(nullif(left(raw_user_meta_data->>'displayName', 80), ''), split_part(email, '@', 1), 'Teammate') into display from auth.users where id = auth.uid();
  insert into public.chair_workspaces(name, created_by) values (btrim(p_name), auth.uid()) returning * into w;
  insert into public.chair_memberships(workspace_id, user_id, display_name, role) values (w.id, auth.uid(), display, 'owner');
  insert into public.chair_chats(workspace_id, title, created_by) values (w.id, 'General', auth.uid()) returning * into c;
  return jsonb_build_object('workspace', to_jsonb(w), 'chat', to_jsonb(c));
end;
$$;

create or replace function public.chair_create_chat(p_workspace uuid, p_title text) returns public.chair_chats
language plpgsql security definer set search_path = '' as $$
declare c public.chair_chats;
begin
  if not public.chair_is_member(p_workspace) then raise exception 'Workspace unavailable' using errcode = '42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 80 then raise exception 'Invalid chat title' using errcode = '22023'; end if;
  insert into public.chair_chats(workspace_id, title, created_by) values (p_workspace, btrim(p_title), auth.uid()) returning * into c;
  return c;
end;
$$;

create or replace function public.chair_send_message(p_workspace uuid, p_chat uuid, p_body text, p_client_id uuid) returns public.chair_messages
language plpgsql security definer set search_path = '' as $$
declare m public.chair_messages; display text;
begin
  if not public.chair_is_member(p_workspace) or not exists(select 1 from public.chair_chats where id = p_chat and workspace_id = p_workspace) then raise exception 'Chat unavailable' using errcode = '42501'; end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 10000 or p_client_id is null then raise exception 'Invalid message' using errcode = '22023'; end if;
  select display_name into display from public.chair_memberships where workspace_id = p_workspace and user_id = auth.uid();
  insert into public.chair_messages(workspace_id, chat_id, author_id, author_name, body, client_message_id)
  values (p_workspace, p_chat, auth.uid(), display, btrim(p_body), p_client_id)
  on conflict (chat_id, author_id, client_message_id) do nothing returning * into m;
  if m.id is null then
    select * into m from public.chair_messages where chat_id = p_chat and author_id = auth.uid() and client_message_id = p_client_id;
    if m.body <> btrim(p_body) then raise exception 'Message ID already used' using errcode = '23505'; end if;
  end if;
  return m;
end;
$$;

create or replace function public.chair_create_invitation(p_workspace uuid, p_email text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.chair_invitations; address text := lower(btrim(p_email));
begin
  if not public.chair_is_owner(p_workspace) then raise exception 'Only owners can invite people' using errcode = '42501'; end if;
  if address is null or length(address) > 254 or address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation' using errcode = '22023'; end if;
  if exists(select 1 from public.chair_memberships m join auth.users u on u.id = m.user_id where m.workspace_id = p_workspace and lower(u.email) = address) then raise exception 'Already a member' using errcode = '23505'; end if;
  -- A replacement invite invalidates the previous link. Never grant access here.
  insert into public.chair_invitations(workspace_id, email, token_hash, invited_by)
  values (p_workspace, address, p_token_hash, auth.uid())
  on conflict (workspace_id, email) where accepted_at is null do update set token_hash = excluded.token_hash, expires_at = now() + interval '7 days', invited_by = auth.uid()
  returning * into i;
  return to_jsonb(i) - 'token_hash' - 'invited_by' - 'accepted_by';
end;
$$;

create or replace function public.chair_accept_invitation(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.chair_invitations; address text; display text; confirmed timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select lower(email), email_confirmed_at, coalesce(nullif(left(raw_user_meta_data->>'displayName', 80), ''), split_part(email, '@', 1), 'Teammate') into address, confirmed, display from auth.users where id = auth.uid();
  select * into i from public.chair_invitations where token_hash = p_token_hash for update;
  if i.id is null or i.email is distinct from address or confirmed is null then raise exception 'Invitation unavailable for this account' using errcode = '42501'; end if;
  if i.accepted_by = auth.uid() and public.chair_is_member(i.workspace_id) then return i.workspace_id; end if;
  if i.accepted_at is not null or i.expires_at <= now() then raise exception 'Invitation expired or already used' using errcode = '22023'; end if;
  insert into public.chair_memberships(workspace_id, user_id, display_name, role) values (i.workspace_id, auth.uid(), display, 'member') on conflict do nothing;
  update public.chair_invitations set accepted_by = auth.uid(), accepted_at = now() where id = i.id;
  return i.workspace_id;
end;
$$;

revoke all on function public.chair_is_member(uuid), public.chair_is_owner(uuid), public.chair_create_workspace(text), public.chair_create_chat(uuid, text), public.chair_send_message(uuid, uuid, text, uuid), public.chair_create_invitation(uuid, text, text), public.chair_accept_invitation(text) from public, anon;
grant execute on function public.chair_is_member(uuid), public.chair_is_owner(uuid), public.chair_create_workspace(text), public.chair_create_chat(uuid, text), public.chair_send_message(uuid, uuid, text, uuid), public.chair_create_invitation(uuid, text, text), public.chair_accept_invitation(text) to authenticated;

notify pgrst, 'reload schema';
commit;
