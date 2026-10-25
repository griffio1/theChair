-- Run after workspace-teams.sql. Adds private attachments; preserves all chat history.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('chair-chat-images','chair-chat-images',false,3145728,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=3145728,allowed_mime_types=array['image/webp'];
-- No browser storage policies: the server checks membership before reading bytes.

alter table public.chair_messages add column if not exists images jsonb not null default '[]';
alter table public.chair_messages drop constraint if exists chair_messages_body_check;
alter table public.chair_messages add constraint chair_messages_body_check
  check (length(btrim(body)) <= 10000 and (length(btrim(body)) > 0 or jsonb_array_length(images) > 0));
alter table public.messages add column if not exists images jsonb not null default '[]';
alter table public.messages add column if not exists image_author_id uuid references auth.users(id);
alter table public.messages add column if not exists image_client_id uuid;
create unique index if not exists chair_team_image_retry on public.messages(workspace_id,image_author_id,image_client_id);

create table if not exists public.chair_chat_images (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  client_upload_id uuid not null,
  name text not null,
  mime_type text not null default 'image/webp' check(mime_type='image/webp'),
  width integer not null check(width between 1 and 4096),
  height integer not null check(height between 1 and 4096),
  size integer not null check(size between 1 and 3145728),
  content_hash text not null,
  object_path text not null unique,
  ready boolean not null default false,
  message_id uuid references public.chair_messages(id) on delete cascade,
  team_message_id uuid references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (message_id is null or team_message_id is null),
  unique(workspace_id,uploaded_by,client_upload_id)
);
alter table public.chair_chat_images enable row level security;
revoke all on public.chair_chat_images from public,anon,authenticated;
grant select on public.chair_chat_images to authenticated;
grant all on public.chair_chat_images to service_role;
drop policy if exists chair_image_read on public.chair_chat_images;
create policy chair_image_read on public.chair_chat_images for select to authenticated using (
  public.chair_is_member(workspace_id) and ready and
  (message_id is not null or team_message_id is not null or
   (uploaded_by=auth.uid() and created_at > now()-interval '24 hours'))
);

-- One transaction validates ownership, posts the message and consumes its images.
-- Workspace locking also serializes concurrent retries and member-role changes.
create or replace function public.chair_send_images(
  p_workspace uuid,p_chat uuid,p_body text,p_client_id uuid,p_images uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; existing jsonb; image_ids uuid[]; image_data jsonb;
  display text; posted uuid; image_count integer;
begin
  perform 1 from public.chair_workspaces where id=p_workspace for update;
  if not public.chair_is_member(p_workspace) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
  if p_body is null or length(btrim(p_body))>10000 or p_client_id is null or p_images is null
     or cardinality(p_images)>4 or array_position(p_images,null) is not null
     or cardinality(p_images)<>(select count(distinct x) from unnest(p_images) x)
     or (length(btrim(p_body))=0 and cardinality(p_images)=0)
     or (p_chat is null and cardinality(p_images)=0)
  then raise exception 'Invalid message or images' using errcode='22023'; end if;
  if p_chat is not null and not exists(select 1 from public.chair_chats where id=p_chat and workspace_id=p_workspace)
  then raise exception 'Chat unavailable' using errcode='42501'; end if;
  if p_chat is null then
    select to_jsonb(m) into existing from public.messages m where workspace_id=p_workspace and image_author_id=auth.uid() and image_client_id=p_client_id;
  else
    select to_jsonb(m) into existing from public.chair_messages m where workspace_id=p_workspace and chat_id=p_chat and author_id=auth.uid() and client_message_id=p_client_id;
  end if;
  if existing is not null then
    select coalesce(array_agg((x->>'id')::uuid order by n),'{}') into image_ids from jsonb_array_elements(existing->'images') with ordinality a(x,n);
    if existing->>'body'<>btrim(p_body) or image_ids<>p_images then raise exception 'Retry payload changed' using errcode='23505'; end if;
    return existing;
  end if;
  perform 1 from public.chair_chat_images where id=any(p_images) order by id for update;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'mimeType',i.mime_type,'width',i.width,'height',i.height,'size',i.size) order by x.n),'[]')
    into image_count,image_data from unnest(p_images) with ordinality x(id,n)
    join public.chair_chat_images i on i.id=x.id where i.workspace_id=p_workspace and i.uploaded_by=auth.uid() and i.ready
      and i.message_id is null and i.team_message_id is null and i.created_at>now()-interval '24 hours';
  if image_count<>cardinality(p_images) then raise exception 'Image unavailable; upload it again' using errcode='42501'; end if;
  select display_name into display from public.chair_memberships where workspace_id=p_workspace and user_id=auth.uid();
  if p_chat is null then
    insert into public.messages(workspace_id,author_type,author_name,kind,body,images,image_author_id,image_client_id)
      values(p_workspace,'human',display,'text',btrim(p_body),image_data,auth.uid(),p_client_id) returning id,to_jsonb(messages.*) into posted,result;
    update public.chair_chat_images set team_message_id=posted where id=any(p_images);
  else
    insert into public.chair_messages(workspace_id,chat_id,author_id,author_name,body,client_message_id,images)
      values(p_workspace,p_chat,auth.uid(),display,btrim(p_body),p_client_id,image_data) returning id,to_jsonb(chair_messages.*) into posted,result;
    update public.chair_chat_images set message_id=posted where id=any(p_images);
  end if;
  return result;
end;
$$;
revoke all on function public.chair_send_images(uuid,uuid,text,uuid,uuid[]) from public,anon;
grant execute on function public.chair_send_images(uuid,uuid,text,uuid,uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
