-- Run after chat-images.sql. Adds reactions without changing messages or membership.
begin;
create table if not exists public.chair_message_reactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  chat_id uuid,
  chat_message_id uuid references public.chair_messages(id) on delete cascade,
  team_message_id uuid references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check(emoji in ('👍','❤️','😂','😮','😢','🎉')),
  created_at timestamptz not null default now(),
  foreign key(workspace_id,chat_id) references public.chair_chats(workspace_id,id) on delete cascade,
  check ((chat_id is not null and chat_message_id is not null and team_message_id is null)
      or (chat_id is null and chat_message_id is null and team_message_id is not null)),
  unique(user_id,emoji,chat_message_id),
  unique(user_id,emoji,team_message_id)
);
create index if not exists chair_reactions_conversation on public.chair_message_reactions(workspace_id,chat_id);
alter table public.chair_message_reactions enable row level security;
revoke all on public.chair_message_reactions from public,anon,authenticated;
grant select on public.chair_message_reactions to authenticated;
grant all on public.chair_message_reactions to service_role;
drop policy if exists chair_reactions_read on public.chair_message_reactions;
create policy chair_reactions_read on public.chair_message_reactions for select to authenticated using(public.chair_is_member(workspace_id));

create or replace function public.chair_read_reactions(p_workspace uuid,p_chat uuid,p_message uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.chair_is_member(p_workspace) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
  if p_chat is not null and not exists(select 1 from public.chair_chats where id=p_chat and workspace_id=p_workspace)
    then raise exception 'Conversation unavailable' using errcode='42501'; end if;
  with latest as (
    select id from (
      select id,created_at from public.chair_messages where workspace_id=p_workspace and chat_id=p_chat and (p_message is null or id=p_message)
      union all
      select id,created_at from public.messages where workspace_id=p_workspace and p_chat is null and (p_message is null or id=p_message)
    ) m order by created_at desc,id desc limit 200
  ), summaries as (
    select coalesce(r.chat_message_id,r.team_message_id) as message_id,r.emoji,
      count(*) as count,bool_or(r.user_id=auth.uid()) as mine,
      jsonb_agg(jsonb_build_object('userId',r.user_id,'displayName',m.display_name) order by m.display_name,r.user_id) as people
    from public.chair_message_reactions r join public.chair_memberships m on m.workspace_id=r.workspace_id and m.user_id=r.user_id
    where r.workspace_id=p_workspace and r.chat_id is not distinct from p_chat
      and coalesce(r.chat_message_id,r.team_message_id) in (select id from latest)
    group by coalesce(r.chat_message_id,r.team_message_id),r.emoji
  ) select coalesce(jsonb_agg(jsonb_build_object('messageId',message_id,'emoji',emoji,'count',count,'reactedByMe',mine,'people',people) order by message_id,emoji),'[]') into result from summaries;
  return result;
end;
$$;

create or replace function public.chair_set_reaction(p_workspace uuid,p_chat uuid,p_message uuid,p_emoji text,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.chair_is_member(p_workspace) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
  if p_emoji is null or p_emoji not in ('👍','❤️','😂','😮','😢','🎉') or p_active is null or p_message is null
    then raise exception 'Invalid reaction' using errcode='22023'; end if;
  if p_chat is null then
    if not exists(select 1 from public.messages where id=p_message and workspace_id=p_workspace)
      then raise exception 'Message unavailable' using errcode='42501'; end if;
    if p_active then
      insert into public.chair_message_reactions(workspace_id,team_message_id,user_id,emoji)
        values(p_workspace,p_message,auth.uid(),p_emoji) on conflict(user_id,emoji,team_message_id) do nothing;
    else
      delete from public.chair_message_reactions where workspace_id=p_workspace and team_message_id=p_message and user_id=auth.uid() and emoji=p_emoji;
    end if;
  else
    if not exists(select 1 from public.chair_messages where id=p_message and workspace_id=p_workspace and chat_id=p_chat)
      then raise exception 'Message unavailable' using errcode='42501'; end if;
    if p_active then
      insert into public.chair_message_reactions(workspace_id,chat_id,chat_message_id,user_id,emoji)
        values(p_workspace,p_chat,p_message,auth.uid(),p_emoji) on conflict(user_id,emoji,chat_message_id) do nothing;
    else
      delete from public.chair_message_reactions where workspace_id=p_workspace and chat_message_id=p_message and user_id=auth.uid() and emoji=p_emoji;
    end if;
  end if;
  return public.chair_read_reactions(p_workspace,p_chat,p_message);
end;
$$;
revoke all on function public.chair_read_reactions(uuid,uuid,uuid),public.chair_set_reaction(uuid,uuid,uuid,text,boolean) from public,anon;
grant execute on function public.chair_read_reactions(uuid,uuid,uuid),public.chair_set_reaction(uuid,uuid,uuid,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
