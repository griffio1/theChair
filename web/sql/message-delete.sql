-- Run after chat-images.sql and chat-reactions.sql. Preserves message IDs and retry safety.
begin;
alter table public.chair_messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists author_user_id uuid references auth.users(id);
-- Only image posts have a trustworthy historical user ID. Never infer from names.
update public.messages set author_user_id=image_author_id where author_user_id is null and image_author_id is not null and author_type='human';

create or replace function public.chair_delete_message(p_workspace uuid,p_chat uuid,p_message uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare author uuid; removed timestamptz;
begin
  perform 1 from public.chair_workspaces where id=p_workspace for update;
  if not public.chair_is_member(p_workspace) then raise exception 'Message unavailable' using errcode='42501'; end if;
  if p_chat is null then
    select coalesce(author_user_id,image_author_id),deleted_at into author,removed from public.messages
      where id=p_message and workspace_id=p_workspace and author_type='human' and kind='text' for update;
  else
    select author_id,deleted_at into author,removed from public.chair_messages
      where id=p_message and workspace_id=p_workspace and chat_id=p_chat for update;
  end if;
  if author is null or author<>auth.uid() then raise exception 'Only your own messages can be deleted' using errcode='42501'; end if;
  if removed is not null then return true; end if;
  -- Revoke image access immediately; retain paths for the existing upload cleanup retry.
  update public.chair_chat_images set ready=false,message_id=null,team_message_id=null,created_at=now()-interval '25 hours'
    where workspace_id=p_workspace and ((p_chat is null and team_message_id=p_message) or (p_chat is not null and message_id=p_message));
  delete from public.chair_message_reactions where workspace_id=p_workspace
    and ((p_chat is null and team_message_id=p_message) or (p_chat is not null and chat_message_id=p_message));
  if p_chat is null then
    update public.messages set body='Message deleted',images='[]',deleted_at=now() where id=p_message and workspace_id=p_workspace;
  else
    update public.chair_messages set body='Message deleted',images='[]',deleted_at=now() where id=p_message and workspace_id=p_workspace;
  end if;
  return true;
end;
$$;
create or replace function public.chair_reaction_live_message() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.chair_workspaces where id=new.workspace_id for update;
  if exists(select 1 from public.chair_messages where id=new.chat_message_id and deleted_at is not null)
    or exists(select 1 from public.messages where id=new.team_message_id and deleted_at is not null)
    then raise exception 'Message deleted' using errcode='42501'; end if;
  return new;
end;
$$;
drop trigger if exists chair_reaction_live_message on public.chair_message_reactions;
create trigger chair_reaction_live_message before insert on public.chair_message_reactions for each row execute function public.chair_reaction_live_message();
revoke all on function public.chair_delete_message(uuid,uuid,uuid),public.chair_reaction_live_message() from public,anon,authenticated;
grant execute on function public.chair_delete_message(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
