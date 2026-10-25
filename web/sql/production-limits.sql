-- Run after chat-reactions.sql and workspace-roles.sql, before deploying the API guards.
-- Preserves existing rows. New writes above a cap fail atomically with PT429.
-- Fixed windows use the database clock; all reservations serialize on one short
-- transaction advisory lock. Counters and writes roll back together on failure.
-- Limits (actor means the signed-in user or the owner who issued an AI key):
--   Workspaces: 10/hour/creator, 20 created total, 200/day/site; confirmed email required.
--   Chats: 30/hour/actor/workspace; 100 stored/workspace.
--   Invites: 20/hour/actor/workspace; 100 live pending/workspace.
--   Messages: 60/minute/actor/workspace; 2,000/day/workspace, including team messages.
--   Reactions: 120/minute/actor/workspace; 5,000/day/workspace.
--   Images: 30/hour/actor/workspace; 100/day/workspace; 20 unattached + 30 MiB
--     unattached/actor/workspace; 100 MiB stored/workspace; 2 GiB stored/site.
--     Metadata reserves bytes before upload. Retired drafts count until deleted.
--   AI keys: 10/hour/issuer/workspace; 20 active/workspace.
--   AI chat: 30/hour + 100/day/actor; 100/hour + 300/day/workspace.
--   Preflight: 120/minute + 1,000/day/actor; 300/minute + 3,000/day/workspace.
--   Proposals: 30/hour/actor; 100/hour + 200/day/workspace.
--   Extraction: 60/hour/owner; 100/hour + 200/day/workspace.
--   AI chat + extraction share a 500 operations/day/site ceiling.
-- Direct authenticated RPC writes hit the triggers. Retry INSERTs that do not
-- create a row are not charged. Reads/polling and removing reactions are free.
begin;

create table if not exists public.chair_usage_windows (
  action text not null,
  workspace_id uuid not null,
  actor_id uuid not null,
  window_start timestamptz not null,
  expires_at timestamptz not null,
  used bigint not null check(used >= 0),
  primary key(action,workspace_id,actor_id,window_start)
);
create index if not exists chair_usage_expiry on public.chair_usage_windows(expires_at);
alter table public.chair_usage_windows enable row level security;
revoke all on public.chair_usage_windows from public,anon,authenticated;
grant select on public.chair_usage_windows to service_role;

create or replace function public.chair_usage_lock() returns void
language sql volatile security definer set search_path='' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('thechair:production-limits:v1',0));
$$;

create or replace function public.chair_take_usage(
  p_workspace uuid,p_actor uuid,p_action text,p_actor_limit integer,p_workspace_limit integer,p_seconds integer
) returns void language plpgsql volatile security definer set search_path='' as $$
declare zero_id constant uuid := '00000000-0000-0000-0000-000000000000';
  window_at timestamptz; slot text; used_count bigint; who uuid; cap integer; i integer;
begin
  perform public.chair_usage_lock();
  if p_seconds < 1 or p_actor_limit < 0 or p_workspace_limit < 0 then
    raise exception 'Invalid usage rule' using errcode='22023';
  end if;
  window_at := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_seconds) * p_seconds);
  slot := p_action || ':' || p_seconds::text;
  delete from public.chair_usage_windows where expires_at < now()-interval '1 day';
  for i in 1..2 loop
    who := case when i=1 then p_actor else zero_id end;
    cap := case when i=1 then p_actor_limit else p_workspace_limit end;
    if cap=0 or who is null then continue; end if;
    used_count := null;
    insert into public.chair_usage_windows as u(action,workspace_id,actor_id,window_start,expires_at,used)
      values(slot,coalesce(p_workspace,zero_id),who,window_at,window_at+make_interval(secs=>p_seconds),1)
      on conflict(action,workspace_id,actor_id,window_start) do update set used=u.used+1
      where u.used < cap returning used into used_count;
    if used_count is null then
      raise exception 'Usage limit reached. Wait a while and try again.' using errcode='PT429';
    end if;
  end loop;
end;
$$;

create or replace function public.chair_apply_write_budget() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; space uuid; n bigint; bytes bigint; current_user_id uuid := auth.uid();
begin
  perform public.chair_usage_lock();
  case tg_table_name
    when 'chair_workspaces' then
      actor := new.created_by;
      if current_user_id is not null and actor<>current_user_id then
        raise exception 'Account mismatch' using errcode='42501';
      end if;
      if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
        raise exception 'Confirm your email before creating a workspace.' using errcode='42501';
      end if;
      if (select count(*) from public.chair_workspaces where created_by=actor)>20 then
        raise exception 'You have reached the 20 workspace limit.' using errcode='PT429';
      end if;
      perform public.chair_take_usage(null,actor,'workspace_create',10,0,3600);
      perform public.chair_take_usage(null,null,'workspace_create_site',0,200,86400);
      return null;
    when 'chair_chats' then actor := new.created_by; space := new.workspace_id;
    when 'chair_invitations' then
      if tg_op='UPDATE' and new.token_hash is not distinct from old.token_hash then return null; end if;
      actor := new.invited_by; space := new.workspace_id;
    when 'chair_messages' then actor := new.author_id; space := new.workspace_id;
    when 'chair_message_reactions' then actor := new.user_id; space := new.workspace_id;
    when 'chair_chat_images' then actor := new.uploaded_by; space := new.workspace_id;
    when 'chair_agent_credentials' then actor := new.issued_by; space := new.workspace_id;
    when 'messages' then actor := new.image_author_id; space := new.workspace_id;
    else raise exception 'Unsupported usage table' using errcode='22023';
  end case;
  if current_user_id is not null and actor is distinct from current_user_id then
    raise exception 'Account mismatch' using errcode='42501';
  end if;
  if actor is not null and not exists(select 1 from public.chair_memberships where workspace_id=space and user_id=actor) then
    raise exception 'Workspace unavailable' using errcode='42501';
  end if;
  case tg_table_name
    when 'chair_chats' then
      if (select count(*) from public.chair_chats where workspace_id=space)>100 then
        raise exception 'This workspace has reached the 100 chat limit.' using errcode='PT429';
      end if;
      perform public.chair_take_usage(space,actor,'chat_create',30,0,3600);
    when 'chair_invitations' then
      if (select count(*) from public.chair_invitations where workspace_id=space and accepted_at is null and expires_at>now())>100 then
        raise exception 'This workspace already has 100 pending invites.' using errcode='PT429';
      end if;
      perform public.chair_take_usage(space,actor,'invite_create',20,0,3600);
    when 'chair_messages','messages' then
      perform public.chair_take_usage(space,actor,'message_create',60,0,60);
      perform public.chair_take_usage(space,null,'message_create',0,2000,86400);
    when 'chair_message_reactions' then
      perform public.chair_take_usage(space,actor,'reaction_create',120,0,60);
      perform public.chair_take_usage(space,null,'reaction_create',0,5000,86400);
    when 'chair_chat_images' then
      select count(*),coalesce(sum(size),0) into n,bytes from public.chair_chat_images
        where workspace_id=space and uploaded_by=actor and message_id is null and team_message_id is null;
      if n>20 or bytes>31457280 then
        raise exception 'Too many unsent images. Send your drafts or try again tomorrow.' using errcode='PT429';
      end if;
      if (select coalesce(sum(size),0) from public.chair_chat_images where workspace_id=space)>104857600 then
        raise exception 'This workspace has reached its 100 MiB image limit.' using errcode='PT429';
      end if;
      if (select coalesce(sum(size),0) from public.chair_chat_images)>2147483648 then
        raise exception 'Image storage is full. Contact the site owner.' using errcode='PT429';
      end if;
      perform public.chair_take_usage(space,actor,'image_create',30,0,3600);
      perform public.chair_take_usage(space,null,'image_create',0,100,86400);
    when 'chair_agent_credentials' then
      if not exists(select 1 from public.chair_memberships where workspace_id=space and user_id=actor and role='owner') then
        raise exception 'Owner required' using errcode='42501';
      end if;
      if (select count(*) from public.chair_agent_credentials where workspace_id=space and revoked_at is null and expires_at>now())>20 then
        raise exception 'This workspace already has 20 active AI access keys.' using errcode='PT429';
      end if;
      perform public.chair_take_usage(space,actor,'agent_key_create',10,0,3600);
  end case;
  return null;
end;
$$;

do $$ declare table_name text; begin
  foreach table_name in array array['chair_workspaces','chair_chats','chair_messages','messages','chair_message_reactions','chair_chat_images','chair_agent_credentials'] loop
    execute format('drop trigger if exists chair_usage_write on public.%I',table_name);
    execute format('create trigger chair_usage_write after insert on public.%I for each row execute function public.chair_apply_write_budget()',table_name);
  end loop;
end $$;
drop trigger if exists chair_usage_write on public.chair_invitations;
create trigger chair_usage_write after insert or update of token_hash on public.chair_invitations
  for each row execute function public.chair_apply_write_budget();

-- Never grant this RPC to browser roles: its actor comes from verified server
-- identity (or the connected repository owner), never a request body/header.
create or replace function public.chair_consume_server_budget(p_workspace uuid,p_actor uuid,p_action text)
returns void language plpgsql volatile security definer set search_path='' as $$
declare member_role text;
begin
  perform public.chair_usage_lock();
  select role into member_role from public.chair_memberships where workspace_id=p_workspace and user_id=p_actor;
  if member_role is null or (p_action='extraction' and member_role<>'owner') then
    raise exception 'Workspace access required' using errcode='42501';
  end if;
  case p_action
    when 'ai_chat' then
      perform public.chair_take_usage(p_workspace,p_actor,'ai_chat',30,100,3600);
      perform public.chair_take_usage(p_workspace,p_actor,'ai_chat',100,300,86400);
      perform public.chair_take_usage(null,null,'ai_operations_site',0,500,86400);
    when 'preflight' then
      perform public.chair_take_usage(p_workspace,p_actor,'preflight',120,300,60);
      perform public.chair_take_usage(p_workspace,p_actor,'preflight',1000,3000,86400);
    when 'proposal' then
      perform public.chair_take_usage(p_workspace,p_actor,'proposal',30,100,3600);
      perform public.chair_take_usage(p_workspace,null,'proposal',0,200,86400);
    when 'extraction' then
      perform public.chair_take_usage(p_workspace,p_actor,'extraction',60,100,3600);
      perform public.chair_take_usage(p_workspace,null,'extraction',0,200,86400);
      perform public.chair_take_usage(null,null,'ai_operations_site',0,500,86400);
    else raise exception 'Unknown usage action' using errcode='22023';
  end case;
end;
$$;
revoke all on function public.chair_usage_lock(),public.chair_take_usage(uuid,uuid,text,integer,integer,integer),
  public.chair_apply_write_budget(),public.chair_consume_server_budget(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.chair_consume_server_budget(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
