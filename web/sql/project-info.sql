-- Run after production-limits.sql. Adds project info and private images; preserves chats.
begin;
alter table public.chair_workspaces add column if not exists slug text;
alter table public.chair_workspaces add column if not exists project_description text not null default '';
alter table public.chair_workspaces add column if not exists project_hackathon boolean not null default false;
alter table public.chair_workspaces add column if not exists project_deadline timestamptz;
alter table public.chair_workspaces add column if not exists project_revision integer not null default 0;
alter table public.chair_workspaces add column if not exists project_updated_at timestamptz not null default now();

create or replace function public.chair_workspace_slug() returns trigger
language plpgsql security definer set search_path='' as $$
declare base text; candidate text; suffix integer:=0;
begin
  if tg_op='UPDATE' and old.slug is not null then
    if new.slug is distinct from old.slug then raise exception 'Project links are permanent' using errcode='22023'; end if;
    return new;
  end if;
  perform pg_advisory_xact_lock(58124,731);
  base:=left(trim(both '-' from regexp_replace(lower(new.name),'[^a-z0-9]+','-','g')),60);
  if base='' then base:='project'; end if;
  if base in ('account','new','api') or base ~ '^[0-9a-f]{8}-[0-9a-f-]{27}$' then base:='project-'||base; end if;
  candidate:=base;
  while exists(select 1 from public.chair_workspaces where slug=candidate and id<>new.id) loop
    suffix:=suffix+1; candidate:=base||'-'||left(new.id::text,8)||case when suffix>1 then '-'||suffix else '' end;
  end loop;
  new.slug:=candidate;
  return new;
end;
$$;
drop trigger if exists chair_workspace_slug_set on public.chair_workspaces;
create trigger chair_workspace_slug_set before insert or update of slug on public.chair_workspaces for each row execute function public.chair_workspace_slug();
-- Existing projects get readable, unique links in creation order.
do $$ declare item record; begin
  for item in select id from public.chair_workspaces where slug is null order by created_at,id loop
    update public.chair_workspaces set slug='' where id=item.id;
  end loop;
end $$;
alter table public.chair_workspaces alter column slug set not null;
create unique index if not exists chair_workspace_slug_unique on public.chair_workspaces(slug);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chair-project-images','chair-project-images',false,3145728,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=3145728,allowed_mime_types=array['image/webp'];

create table if not exists public.chair_project_images (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  client_upload_id uuid not null,
  name text not null,
  mime_type text not null default 'image/webp' check(mime_type='image/webp'),
  width integer not null check(width between 1 and 4096),
  height integer not null check(height between 1 and 4096),
  size integer not null check(size between 1 and 3145728),
  content_hash text not null, object_path text not null unique,
  ready boolean not null default false, attached boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique(workspace_id,uploaded_by,client_upload_id)
);
alter table public.chair_project_images enable row level security;
revoke all on public.chair_project_images from public,anon,authenticated;
grant select on public.chair_project_images to authenticated;
grant all on public.chair_project_images to service_role;
drop policy if exists chair_project_image_read on public.chair_project_images;
create policy chair_project_image_read on public.chair_project_images for select to authenticated using(
  public.chair_is_member(workspace_id) and ready and (attached or
    (uploaded_by=auth.uid() and created_at>now()-interval '24 hours'))
);

create or replace function public.chair_project_image_limit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.chair_workspaces where id=new.workspace_id for update;
  if not exists(select 1 from public.chair_memberships where workspace_id=new.workspace_id and user_id=new.uploaded_by and role='owner')
    then raise exception 'Only owners can upload project images' using errcode='42501'; end if;
  if exists(select 1 from public.chair_project_images where workspace_id=new.workspace_id and uploaded_by=new.uploaded_by and client_upload_id=new.client_upload_id) then return new; end if;
  if (select count(*) from public.chair_project_images where workspace_id=new.workspace_id and not attached)>=16
    or (select coalesce(sum(size),0) from public.chair_project_images where workspace_id=new.workspace_id)+new.size>52428800
    then raise exception 'Project image limit reached. Remove unused images or try tomorrow.' using errcode='PT429'; end if;
  return new;
end;
$$;
drop trigger if exists chair_project_image_limit on public.chair_project_images;
create trigger chair_project_image_limit before insert on public.chair_project_images for each row execute function public.chair_project_image_limit();

create or replace function public.chair_save_project(p_workspace uuid,p_name text,p_description text,p_hackathon boolean,p_deadline timestamptz,p_images uuid[],p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.chair_workspaces; image_count integer; images jsonb;
begin
  select * into w from public.chair_workspaces where id=p_workspace for update;
  if not public.chair_is_owner(p_workspace) then raise exception 'Only owners can edit this project' using errcode='42501'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_description is null or length(p_description)>10000
     or p_hackathon is null or (p_hackathon and (p_deadline is null or not isfinite(p_deadline)))
     or p_revision is null or p_images is null or cardinality(p_images)>4 or array_position(p_images,null) is not null
     or cardinality(p_images)<>(select count(distinct x) from unnest(p_images) x)
    then raise exception 'Invalid project details' using errcode='22023'; end if;
  if w.project_revision<>p_revision then raise exception 'Project changed; reload before saving' using errcode='PT409'; end if;
  perform 1 from public.chair_project_images where workspace_id=p_workspace order by id for update;
  select count(*) into image_count from public.chair_project_images where id=any(p_images) and workspace_id=p_workspace and ready
    and (attached or (uploaded_by=auth.uid() and created_at>now()-interval '24 hours'));
  if image_count<>cardinality(p_images) then raise exception 'Image unavailable; upload it again' using errcode='42501'; end if;
  update public.chair_project_images set attached=false where workspace_id=p_workspace and attached and not(id=any(p_images));
  update public.chair_project_images i set attached=true,position=x.n from unnest(p_images) with ordinality x(id,n) where i.id=x.id;
  update public.chair_workspaces set name=btrim(p_name),project_description=p_description,project_hackathon=p_hackathon,
    project_deadline=case when p_hackathon then p_deadline else null end,project_revision=project_revision+1,project_updated_at=now()
    where id=p_workspace returning * into w;
  select coalesce(jsonb_agg(to_jsonb(i) order by position),'[]') into images from public.chair_project_images i where workspace_id=p_workspace and attached;
  return jsonb_build_object('workspace',to_jsonb(w),'images',images);
end;
$$;
revoke all on function public.chair_workspace_slug(),public.chair_project_image_limit(),public.chair_save_project(uuid,text,text,boolean,timestamptz,uuid[],integer) from public,anon,authenticated;
grant execute on function public.chair_save_project(uuid,text,text,boolean,timestamptz,uuid[],integer) to authenticated;
notify pgrst,'reload schema';
commit;
