-- Run after workspace-teams.sql. Durable, server-only GitHub inbox.
begin;
create table if not exists public.chair_webhook_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.chair_workspaces(id) on delete cascade,
  delivery_id text not null check(length(delivery_id) between 1 and 160),
  payload jsonb not null,
  status text not null default 'queued' check(status in ('queued','processing','complete','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,delivery_id)
);
create index if not exists chair_webhook_ready on public.chair_webhook_jobs(status,available_at);
alter table public.chair_webhook_jobs enable row level security;
revoke all on public.chair_webhook_jobs from public,anon,authenticated;
grant all on public.chair_webhook_jobs to service_role;

create or replace function public.chair_enqueue_webhook(p_workspace uuid,p_delivery text,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.chair_webhook_jobs; result uuid;
begin
  -- Global lock makes backlog/day caps consistent across serverless instances.
  perform pg_advisory_xact_lock(839104021);
  select * into existing from public.chair_webhook_jobs where workspace_id=p_workspace and delivery_id=p_delivery;
  if found then
    if existing.payload<>p_payload then raise exception 'Delivery payload changed' using errcode='23505'; end if;
    return existing.id;
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>8192
    or p_delivery is null or length(p_delivery) not between 1 and 160
    then raise exception 'Invalid delivery' using errcode='22023'; end if;
  if (select count(*) from public.chair_webhook_jobs where workspace_id=p_workspace and status in ('queued','processing'))>=100
    or (select count(*) from public.chair_webhook_jobs where created_at>=date_trunc('day',now()))>=1000
    then raise exception 'Webhook capacity reached' using errcode='P0001'; end if;
  insert into public.chair_webhook_jobs(workspace_id,delivery_id,payload) values(p_workspace,p_delivery,p_payload) returning id into result;
  return result;
end;
$$;

create or replace function public.chair_claim_webhook(p_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate uuid; result jsonb;
begin
  delete from public.chair_webhook_jobs where status='complete' and updated_at<now()-interval '30 days';
  update public.chair_webhook_jobs set status='failed',lease_token=null,lease_until=null,
    last_error='Worker stopped after the final attempt.',updated_at=now()
    where status='processing' and lease_until<now() and attempts>=8;
  select id into candidate from public.chair_webhook_jobs
    where (p_id is null or id=p_id) and attempts<8 and
      ((status='queued' and available_at<=now()) or (status='processing' and lease_until<now()))
    order by available_at,created_at for update skip locked limit 1;
  if candidate is null then return null; end if;
  update public.chair_webhook_jobs set status='processing',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '330 seconds',updated_at=now()
    where id=candidate returning to_jsonb(chair_webhook_jobs.*) into result;
  return result;
end;
$$;

create or replace function public.chair_finish_webhook(p_id uuid,p_lease uuid,p_ok boolean,p_retry_after integer default 0)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  update public.chair_webhook_jobs set
    status=case when p_ok then 'complete' when attempts>=8 then 'failed' else 'queued' end,
    available_at=now()+make_interval(secs=>greatest(30,least(86400,
      case when p_retry_after>0 then p_retry_after else (30*power(2,least(attempts,7)))::integer end))),
    last_error=case when p_ok then null when attempts>=8 then 'Check failed after 8 attempts. Review and retry.' else 'Check failed; retry scheduled.' end,
    lease_token=null,lease_until=null,updated_at=now()
    where id=p_id and status='processing' and lease_token=p_lease and lease_until>now();
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;

-- Operator recovery after fixing a failed delivery. Does not alter completed jobs.
create or replace function public.chair_retry_webhook(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  update public.chair_webhook_jobs set status='queued',attempts=0,available_at=now(),last_error=null,updated_at=now()
    where id=p_id and status='failed';
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;
revoke all on function public.chair_enqueue_webhook(uuid,text,jsonb),public.chair_claim_webhook(uuid),public.chair_finish_webhook(uuid,uuid,boolean,integer),public.chair_retry_webhook(uuid) from public,anon,authenticated;
grant execute on function public.chair_enqueue_webhook(uuid,text,jsonb),public.chair_claim_webhook(uuid),public.chair_finish_webhook(uuid,uuid,boolean,integer),public.chair_retry_webhook(uuid) to service_role;
notify pgrst,'reload schema';
commit;
