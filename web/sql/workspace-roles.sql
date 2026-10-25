-- Run after workspace-teams.sql. Enables owner-controlled member promotion.
begin;
create or replace function public.chair_change_member_role(p_workspace uuid,p_user uuid,p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.chair_memberships;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_role is null or p_role not in ('owner','member') then raise exception 'Invalid role' using errcode='22023'; end if;
  -- Serialize all role changes for this workspace, including competing demotions.
  perform 1 from public.chair_workspaces where id=p_workspace for update;
  if not public.chair_is_owner(p_workspace) then raise exception 'Owner required' using errcode='42501'; end if;
  select * into target from public.chair_memberships where workspace_id=p_workspace and user_id=p_user;
  if not found then raise exception 'Member unavailable' using errcode='22023'; end if;
  if target.role='owner' and p_role='member' and
     (select count(*) from public.chair_memberships where workspace_id=p_workspace and role='owner') <= 1 then
    raise exception 'A workspace must keep at least one owner' using errcode='23514';
  end if;
  update public.chair_memberships set role=p_role where workspace_id=p_workspace and user_id=p_user returning * into target;
  return jsonb_build_object('userId',target.user_id,'displayName',target.display_name,'role',target.role,'joinedAt',target.joined_at);
end $$;
revoke all on function public.chair_change_member_role(uuid,uuid,text) from public,anon;
grant execute on function public.chair_change_member_role(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
