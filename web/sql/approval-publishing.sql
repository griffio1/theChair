-- Run after workspace-teams.sql. Private, resumable publication of approvals.
begin;
create table if not exists public.chair_approval_jobs (
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  operation_key text not null,
  kind text not null check(kind in ('contract','conflict')),
  target_id text not null,
  target_version integer,
  approved_by text not null,
  contract jsonb,
  status text not null default 'pending' check(status in ('pending','complete','cancelled')),
  lease_id uuid,
  lease_until timestamptz,
  branch text,
  base_sha text,
  candidate_sha text,
  commit_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,operation_key)
);
create unique index if not exists chair_one_pending_approval
  on public.chair_approval_jobs(workspace_id) where status='pending';
alter table public.chair_approval_jobs enable row level security;
revoke all on public.chair_approval_jobs from public,anon,authenticated;
grant all on public.chair_approval_jobs to service_role;

create or replace function public.chair_take_approval(
  p_workspace uuid,p_kind text,p_id text,p_version integer,p_approved_by text,p_lease uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.chair_approval_jobs; agreement public.contracts;
  issue public.conflicts; operation text; snapshot jsonb;
begin
  if p_kind is null or p_kind not in ('contract','conflict') or p_id is null or length(p_id)>100
     or p_approved_by is null or length(btrim(p_approved_by))=0 or p_lease is null
     or (p_kind='contract' and (p_id !~ '^[a-z0-9-]+$' or p_version is null or p_version<1))
     or (p_kind='conflict' and p_id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  then raise exception 'Invalid approval' using errcode='22023'; end if;
  perform 1 from public.chair_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace unavailable' using errcode='42501'; end if;
  operation := p_kind||':'||p_id||case when p_kind='contract' then '@'||p_version else '' end;
  select * into job from public.chair_approval_jobs where workspace_id=p_workspace and operation_key=operation for update;
  if job.status='complete' then return to_jsonb(job); end if;
  if job.status='cancelled' then
    delete from public.chair_approval_jobs where workspace_id=p_workspace and operation_key=operation;
    job := null;
  end if;
  if exists(select 1 from public.chair_approval_jobs where workspace_id=p_workspace and status='pending' and operation_key<>operation)
    then raise exception 'Finish the pending approval before approving another change' using errcode='55P03'; end if;
  if job.lease_until>now() and job.lease_id is distinct from p_lease
    then raise exception 'Approval is running; retry shortly' using errcode='55P03'; end if;
  if job.operation_key is null then
    if p_kind='contract' then
      select * into agreement from public.contracts where workspace_id=p_workspace and id=p_id and version=p_version;
      if not found then raise exception 'Agreement unavailable' using errcode='P0002'; end if;
      if agreement.status='superseded' or exists(select 1 from public.contracts where workspace_id=p_workspace and id=p_id and status='approved' and version>p_version)
        then raise exception 'A newer agreement is already approved' using errcode='40001'; end if;
    else
      select * into issue from public.conflicts where workspace_id=p_workspace and id=p_id::uuid;
      if not found or issue.status='dismissed' then raise exception 'Issue unavailable' using errcode='P0002'; end if;
      select * into agreement from public.contracts where workspace_id=p_workspace and id=issue.contract_id and status='approved' order by version desc limit 1;
    end if;
    if agreement.id is not null then
      snapshot := jsonb_strip_nulls(to_jsonb(agreement)-'workspace_id'-'proposed_by'-'created_at')||'{"status":"approved"}'::jsonb;
    end if;
    insert into public.chair_approval_jobs(workspace_id,operation_key,kind,target_id,target_version,approved_by,contract)
      values(p_workspace,operation,p_kind,p_id,p_version,p_approved_by,snapshot) returning * into job;
  end if;
  update public.chair_approval_jobs set lease_id=p_lease,lease_until=now()+interval '2 minutes',updated_at=now()
    where workspace_id=p_workspace and operation_key=operation returning * into job;
  return to_jsonb(job);
end;
$$;

create or replace function public.chair_stage_approval(
  p_workspace uuid,p_key text,p_lease uuid,p_candidate jsonb,p_clear_sha text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.chair_approval_jobs;
begin
  perform 1 from public.chair_workspaces where id=p_workspace for update;
  select * into job from public.chair_approval_jobs where workspace_id=p_workspace and operation_key=p_key for update;
  if not found or job.status<>'pending' or p_lease is null or job.lease_id is distinct from p_lease or job.lease_until is null or job.lease_until<=now()
    then raise exception 'Approval lease expired; retry this approval' using errcode='55P03'; end if;
  if job.contract is not null and exists(select 1 from public.contracts where workspace_id=p_workspace and id=job.contract->>'id' and status='approved' and version>(job.contract->>'version')::integer)
    then raise exception 'A newer agreement is already approved' using errcode='40001'; end if;
  if p_clear_sha is not null then
    if job.candidate_sha is distinct from p_clear_sha then raise exception 'Approval candidate changed' using errcode='40001'; end if;
    update public.chair_approval_jobs set branch=null,base_sha=null,candidate_sha=null where workspace_id=p_workspace and operation_key=p_key;
  else
    if p_candidate is null or jsonb_typeof(p_candidate)<>'object'
       or coalesce(p_candidate->>'branch','')='' or length(p_candidate->>'branch')>250
       or coalesce(p_candidate->>'sha','') !~ '^[0-9a-f]{40,64}$'
       or coalesce(p_candidate->>'baseSha','') !~ '^[0-9a-f]{40,64}$'
    then raise exception 'Invalid publication candidate' using errcode='22023'; end if;
    update public.chair_approval_jobs set branch=p_candidate->>'branch',base_sha=p_candidate->>'baseSha',candidate_sha=p_candidate->>'sha'
      where workspace_id=p_workspace and operation_key=p_key;
  end if;
  update public.chair_approval_jobs set lease_until=now()+interval '2 minutes',updated_at=now()
    where workspace_id=p_workspace and operation_key=p_key returning * into job;
  return to_jsonb(job);
end;
$$;

create or replace function public.chair_finish_approval(
  p_workspace uuid,p_key text,p_lease uuid,p_commit_sha text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.chair_approval_jobs; agreement_id text; agreement_version integer;
begin
  perform 1 from public.chair_workspaces where id=p_workspace for update;
  select * into job from public.chair_approval_jobs where workspace_id=p_workspace and operation_key=p_key for update;
  if job.status='complete' then return to_jsonb(job); end if;
  if not found or job.status<>'pending' or p_lease is null or job.lease_id is distinct from p_lease or job.lease_until is null or job.lease_until<=now()
    then raise exception 'Approval lease expired; retry this approval' using errcode='55P03'; end if;
  if job.contract is not null then
    if p_commit_sha is null or p_commit_sha is distinct from job.candidate_sha
      then raise exception 'Approval publication is not confirmed' using errcode='40001'; end if;
    agreement_id := job.contract->>'id'; agreement_version := (job.contract->>'version')::integer;
    if exists(select 1 from public.contracts where workspace_id=p_workspace and id=agreement_id and status='approved' and version>agreement_version)
      then raise exception 'A newer agreement is already approved' using errcode='40001'; end if;
  elsif p_commit_sha is not null then raise exception 'Unexpected publication' using errcode='22023'; end if;
  if job.kind='contract' then
    update public.contracts set status='superseded' where workspace_id=p_workspace and id=agreement_id and status='approved' and version<agreement_version;
    update public.contracts set status='approved' where workspace_id=p_workspace and id=agreement_id and version=agreement_version;
    if not found then raise exception 'Agreement unavailable' using errcode='P0002'; end if;
  else
    update public.conflicts set status='approved' where workspace_id=p_workspace and id=job.target_id::uuid and status<>'dismissed';
    if not found then raise exception 'Issue unavailable' using errcode='P0002'; end if;
  end if;
  insert into public.events(workspace_id,type,summary,sha)
    values(p_workspace,'approval',job.approved_by||' approved '||job.target_id,p_commit_sha);
  insert into public.messages(workspace_id,author_type,author_name,kind,body,ref_id)
    values(p_workspace,'system','theChair','event',
      case when job.kind='contract' then 'Approved '||agreement_id||' v'||agreement_version||'. Saved to GitHub.'
      else 'Agreement approved for this issue. Apply the code fix, then check again.' end,job.target_id);
  update public.chair_approval_jobs set status='complete',commit_sha=p_commit_sha,lease_id=null,lease_until=null,updated_at=now()
    where workspace_id=p_workspace and operation_key=p_key returning * into job;
  return to_jsonb(job);
end;
$$;

create or replace function public.chair_release_approval(p_workspace uuid,p_key text,p_lease uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.chair_approval_jobs set lease_id=null,lease_until=null,updated_at=now()
    where workspace_id=p_workspace and operation_key=p_key and lease_id=p_lease and status='pending';
end;
$$;

-- Operator recovery: retry the SAME approval after correcting GitHub permissions.
-- Completed operations replay their result; crashed workers can be reclaimed after
-- two minutes. Saved candidate commits are reconciled by ancestry, never force-pushed.
-- To abandon a never-published operation, use this service-only function. It refuses
-- a saved/ambiguous commit; inspect GitHub and the row before any manual repair.
create or replace function public.chair_cancel_approval(p_workspace uuid,p_key text)
returns void language plpgsql security definer set search_path='' as $$
declare job public.chair_approval_jobs;
begin
  perform 1 from public.chair_workspaces where id=p_workspace for update;
  select * into job from public.chair_approval_jobs where workspace_id=p_workspace and operation_key=p_key for update;
  if not found then return; end if;
  if job.status<>'pending' or job.candidate_sha is not null or job.lease_until>now()
    then raise exception 'Review the active or saved publication before cancelling' using errcode='40001'; end if;
  update public.chair_approval_jobs set status='cancelled',updated_at=now() where workspace_id=p_workspace and operation_key=p_key;
end;
$$;
revoke all on function public.chair_take_approval(uuid,text,text,integer,text,uuid),public.chair_stage_approval(uuid,text,uuid,jsonb,text),public.chair_finish_approval(uuid,text,uuid,text),public.chair_release_approval(uuid,text,uuid),public.chair_cancel_approval(uuid,text) from public,anon,authenticated;
grant execute on function public.chair_take_approval(uuid,text,text,integer,text,uuid),public.chair_stage_approval(uuid,text,uuid,jsonb,text),public.chair_finish_approval(uuid,text,uuid,text),public.chair_release_approval(uuid,text,uuid),public.chair_cancel_approval(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
