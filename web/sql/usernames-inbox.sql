-- Run after account-profiles.sql and production-limits.sql. Preserves demo and email invites.
begin;
create table if not exists public.chair_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique check(username ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null default 'Teammate'
);
alter table public.chair_profiles enable row level security;
revoke all on public.chair_profiles from public,anon,authenticated;
grant select on public.chair_profiles to authenticated;
grant all on public.chair_profiles to service_role;
drop policy if exists chair_own_profile on public.chair_profiles;
create policy chair_own_profile on public.chair_profiles for select to authenticated using(user_id=auth.uid());

-- Display names remain names. Nicknames no longer override them.
create or replace function public.chair_profile_label(p_metadata jsonb,p_email text)
returns text language sql immutable set search_path='' as $$
  select coalesce(nullif(left(btrim(case when jsonb_typeof(p_metadata->'displayName')='string' then p_metadata->>'displayName' end),80),''),nullif(left(split_part(p_email,'@',1),80),''),'Teammate');
$$;
insert into public.chair_profiles(user_id,display_name)
select id,public.chair_profile_label(raw_user_meta_data,email) from auth.users on conflict(user_id) do nothing;
update public.chair_memberships m set display_name=p.display_name from public.chair_profiles p where p.user_id=m.user_id and m.display_name is distinct from p.display_name;

create or replace function public.chair_sync_username() returns trigger
language plpgsql security definer set search_path='' as $$
declare handle text; previous text;
begin
  select username into previous from public.chair_profiles where user_id=new.id;
  if new.raw_user_meta_data ? 'username' then
    if jsonb_typeof(new.raw_user_meta_data->'username')<>'string' then raise exception 'Invalid username' using errcode='22023'; end if;
    handle:=lower(regexp_replace(btrim(new.raw_user_meta_data->>'username'),'^@',''));
    if handle !~ '^[a-z0-9_]{3,30}$' or handle in ('admin','administrator','support','thechair','system','moderator') then raise exception 'Invalid username' using errcode='22023'; end if;
  else handle:=previous;
  end if;
  if previous is distinct from handle and previous is not null then
    perform public.chair_take_usage(null,new.id,'username_change',5,0,86400);
  end if;
  insert into public.chair_profiles(user_id,username,display_name)
    values(new.id,handle,public.chair_profile_label(new.raw_user_meta_data,new.email))
    on conflict(user_id) do update set username=excluded.username,display_name=excluded.display_name;
  return new;
end;
$$;
drop trigger if exists chair_username_changed on auth.users;
create trigger chair_username_changed after insert or update of raw_user_meta_data,email on auth.users for each row execute function public.chair_sync_username();

create or replace function public.chair_save_profile(p_display_name text,p_username text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 80 or p_display_name ~ '[[:cntrl:]]' or p_username is null then raise exception 'Invalid profile' using errcode='22023'; end if;
  update auth.users set raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')-'nickname')||jsonb_build_object('displayName',btrim(p_display_name),'username',lower(regexp_replace(btrim(p_username),'^@',''))) where id=auth.uid();
  select jsonb_build_object('userId',user_id,'displayName',display_name,'username',username) into result from public.chair_profiles where user_id=auth.uid();
  return result;
end;
$$;
create or replace function public.chair_username_available(p_username text,p_actor uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform public.chair_take_usage(null,p_actor,'username_lookup',60,600,60);
  return p_username ~ '^[a-z0-9_]{3,30}$' and p_username not in ('admin','administrator','support','thechair','system','moderator') and not exists(select 1 from public.chair_profiles where username=p_username);
end;
$$;

create table if not exists public.chair_user_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'pending' check(status in ('pending','accepted','declined','expired')),
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days'
);
create unique index if not exists chair_user_invite_pending on public.chair_user_invitations(workspace_id,recipient_id) where status='pending';
create index if not exists chair_user_invite_inbox on public.chair_user_invitations(recipient_id,created_at desc);
alter table public.chair_user_invitations enable row level security;
revoke all on public.chair_user_invitations from public,anon,authenticated;
grant all on public.chair_user_invitations to service_role;

create or replace function public.chair_invite_username(p_workspace uuid,p_username text,p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare recipient uuid; i public.chair_user_invitations; reused boolean:=false;
begin
  perform public.chair_usage_lock();
  perform 1 from public.chair_workspaces where id=p_workspace for update;
  if not public.chair_is_owner(p_workspace) then raise exception 'Only owners can invite' using errcode='42501'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invite' using errcode='22023'; end if;
  perform public.chair_take_usage(p_workspace,auth.uid(),'username_invite_attempt',60,300,3600);
  select user_id into recipient from public.chair_profiles where username=lower(regexp_replace(btrim(p_username),'^@',''));
  if recipient is null then raise exception 'Username not found' using errcode='PT404'; end if;
  if exists(select 1 from public.chair_memberships where workspace_id=p_workspace and user_id=recipient) then raise exception 'Already a member' using errcode='PT409'; end if;
  update public.chair_user_invitations set status='expired' where workspace_id=p_workspace and recipient_id=recipient and status='pending' and expires_at<=now();
  select * into i from public.chair_user_invitations where workspace_id=p_workspace and recipient_id=recipient and status='pending';
  if found then reused:=true;
  else
    perform public.chair_take_usage(p_workspace,auth.uid(),'username_invite',20,100,3600);
    if (select count(*) from public.chair_user_invitations where workspace_id=p_workspace and status='pending' and expires_at>now())>=100 then raise exception 'Too many pending invites' using errcode='PT429'; end if;
    insert into public.chair_user_invitations(workspace_id,recipient_id,invited_by,token_hash) values(p_workspace,recipient,auth.uid(),p_token_hash) returning * into i;
  end if;
  return jsonb_build_object('id',i.id,'username',(select username from public.chair_profiles where user_id=recipient),'status',i.status,'expiresAt',i.expires_at,'reused',reused);
end;
$$;

create or replace function public.chair_identity_workspace(p_workspace uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare people jsonb; invites jsonb:='[]';
begin
  if not public.chair_is_member(p_workspace) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('userId',p.user_id,'username',p.username)),'[]') into people from public.chair_profiles p join public.chair_memberships m on m.user_id=p.user_id where m.workspace_id=p_workspace;
  if public.chair_is_owner(p_workspace) then
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'username',p.username,'status',case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end,'expiresAt',i.expires_at) order by i.created_at desc),'[]') into invites
      from public.chair_user_invitations i join public.chair_profiles p on p.user_id=i.recipient_id where i.workspace_id=p_workspace;
  end if;
  return jsonb_build_object('usernames',people,'invitations',invites);
end;
$$;

create or replace function public.chair_notification_count() returns bigint
language sql stable security definer set search_path='' as $$
  select count(*) from public.chair_user_invitations where recipient_id=auth.uid() and status='pending' and expires_at>now() and seen_at is null;
$$;
create or replace function public.chair_notifications() returns jsonb
language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
  select coalesce(jsonb_agg(item order by created_at desc),'[]') into items from (
    select i.created_at,jsonb_build_object('id',i.id,'workspaceName',w.name,'inviterName',p.display_name,'inviterUsername',p.username,
      'status',case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end,'seen',i.seen_at is not null,'createdAt',i.created_at,'expiresAt',i.expires_at) item
    from public.chair_user_invitations i join public.chair_workspaces w on w.id=i.workspace_id join public.chair_profiles p on p.user_id=i.invited_by
    where i.recipient_id=auth.uid() order by (i.status='pending' and i.expires_at>now()) desc,i.created_at desc limit 100
  ) recent;
  return jsonb_build_object('notifications',items,'unreadCount',public.chair_notification_count());
end;
$$;
create or replace function public.chair_notifications_read(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
  if p_ids is null or cardinality(p_ids)>100 then raise exception 'Invalid notifications' using errcode='22023'; end if;
  update public.chair_user_invitations set seen_at=coalesce(seen_at,now()) where recipient_id=auth.uid() and id=any(p_ids);
  return jsonb_build_object('unreadCount',public.chair_notification_count());
end;
$$;
create or replace function public.chair_respond_invitation(p_invitation uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.chair_user_invitations; space uuid; target text;
begin
  if p_action is null or p_action not in ('accept','decline') then raise exception 'Invalid action' using errcode='22023'; end if;
  select workspace_id into space from public.chair_user_invitations where id=p_invitation and recipient_id=auth.uid();
  if space is null then raise exception 'Invite unavailable' using errcode='42501'; end if;
  perform 1 from public.chair_workspaces where id=space for update;
  select * into i from public.chair_user_invitations where id=p_invitation and recipient_id=auth.uid() for update;
  target:=case when p_action='accept' then 'accepted' else 'declined' end;
  if i.status=target then return jsonb_strip_nulls(jsonb_build_object('invitation',jsonb_build_object('id',i.id,'status',i.status),'workspaceId',case when target='accepted' then i.workspace_id else null end)); end if;
  if i.status<>'pending' or i.expires_at<=now() then raise exception 'Invite expired or already answered' using errcode='PT410'; end if;
  if not exists(select 1 from public.chair_memberships where workspace_id=space and user_id=i.invited_by and role='owner') then raise exception 'Invite is no longer available' using errcode='42501'; end if;
  if target='accepted' then
    if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Confirm your email first' using errcode='42501'; end if;
    insert into public.chair_memberships(workspace_id,user_id,display_name,role) values(space,auth.uid(),'Teammate','member') on conflict(workspace_id,user_id) do nothing;
  end if;
  update public.chair_user_invitations set status=target,seen_at=coalesce(seen_at,now()) where id=i.id;
  return jsonb_strip_nulls(jsonb_build_object('invitation',jsonb_build_object('id',i.id,'status',target),'workspaceId',case when target='accepted' then space else null end));
end;
$$;
create or replace function public.chair_accept_any_invitation(p_token_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare invitation_id uuid; result jsonb;
begin
  select id into invitation_id from public.chair_user_invitations where token_hash=p_token_hash;
  if invitation_id is null then return public.chair_accept_invitation(p_token_hash); end if;
  result:=public.chair_respond_invitation(invitation_id,'accept');
  return (result->>'workspaceId')::uuid;
end;
$$;

revoke all on function public.chair_sync_username(),public.chair_save_profile(text,text),public.chair_username_available(text,uuid),public.chair_invite_username(uuid,text,text),public.chair_identity_workspace(uuid),public.chair_notification_count(),public.chair_notifications(),public.chair_notifications_read(uuid[]),public.chair_respond_invitation(uuid,text),public.chair_accept_any_invitation(text) from public,anon,authenticated;
grant execute on function public.chair_save_profile(text,text),public.chair_invite_username(uuid,text,text),public.chair_identity_workspace(uuid),public.chair_notification_count(),public.chair_notifications(),public.chair_notifications_read(uuid[]),public.chair_respond_invitation(uuid,text),public.chair_accept_any_invitation(text) to authenticated;
grant execute on function public.chair_username_available(text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
