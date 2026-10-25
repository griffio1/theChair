-- Run after project-info.sql, usernames-inbox.sql and workspace-teams.sql.
begin;
create table if not exists public.chair_file_removals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  bucket text not null check(bucket in ('chair-chat-images','chair-project-images')),
  object_path text not null,
  available_at timestamptz not null default now()+interval '5 minutes',
  check (object_path like workspace_id::text||'/%'),
  unique(bucket,object_path)
);
alter table public.chair_file_removals enable row level security;
revoke all on public.chair_file_removals from public,anon,authenticated;
grant all on public.chair_file_removals to service_role;

create or replace function public.chair_delete_workspace(p_workspace uuid,p_name text)
returns boolean language plpgsql security definer set search_path='' as $$
declare project_name text;
begin
  select name into project_name from public.chair_workspaces where id=p_workspace for update;
  if not found or not public.chair_is_owner(p_workspace) then
    raise exception 'Only owners can delete this workspace' using errcode='42501'; end if;
  if p_name is null or p_name<>project_name then raise exception 'Type the current workspace name' using errcode='22023'; end if;
  -- Keep paths beyond the cascade. Delay cleanup so in-flight uploads can finish.
  insert into public.chair_file_removals(workspace_id,bucket,object_path)
    select p_workspace,'chair-chat-images',object_path from public.chair_chat_images where workspace_id=p_workspace
    union all select p_workspace,'chair-project-images',object_path from public.chair_project_images where workspace_id=p_workspace
    on conflict(bucket,object_path) do nothing;
  delete from public.chair_legacy_binding where workspace_id=p_workspace;
  delete from public.chair_workspaces where id=p_workspace;
  return true;
end;
$$;
revoke all on function public.chair_delete_workspace(uuid,text) from public,anon,authenticated;
grant execute on function public.chair_delete_workspace(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
