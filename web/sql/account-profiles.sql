-- Run after workspaces.sql. Keeps names in sync; roles and chat history are unchanged.
begin;

create or replace function public.chair_profile_label(p_metadata jsonb,p_email text)
returns text language sql immutable set search_path='' as $$
  select coalesce(
    nullif(left(btrim(case when jsonb_typeof(p_metadata->'nickname')='string' then p_metadata->>'nickname' end),80),''),
    nullif(left(btrim(case when jsonb_typeof(p_metadata->'displayName')='string' then p_metadata->>'displayName' end),80),''),
    nullif(left(split_part(p_email,'@',1),80),''),
    'Teammate'
  );
$$;

create or replace function public.chair_sync_profile_label()
returns trigger language plpgsql security definer set search_path='' as $$
declare label text;
begin
  label := public.chair_profile_label(new.raw_user_meta_data,new.email);
  update public.chair_memberships set display_name=label
    where user_id=new.id and display_name is distinct from label;
  return new;
end;
$$;

drop trigger if exists chair_profile_label_changed on auth.users;
create trigger chair_profile_label_changed
after update of raw_user_meta_data,email on auth.users
for each row when (old.raw_user_meta_data is distinct from new.raw_user_meta_data or old.email is distinct from new.email)
execute function public.chair_sync_profile_label();

create or replace function public.chair_member_profile_label()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select public.chair_profile_label(u.raw_user_meta_data,u.email) into new.display_name
    from auth.users u where u.id=new.user_id;
  return new;
end;
$$;

drop trigger if exists chair_member_profile_label_insert on public.chair_memberships;
create trigger chair_member_profile_label_insert before insert on public.chair_memberships
for each row execute function public.chair_member_profile_label();

revoke all on function public.chair_profile_label(jsonb,text),public.chair_sync_profile_label(),public.chair_member_profile_label() from public,anon,authenticated;
commit;
