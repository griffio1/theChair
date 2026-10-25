import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("durable webhook inbox isolates roles, deduplicates, leases, retries and caps backlog",async()=>{
  const db=new PGlite(); const w=randomUUID(), other=randomUUID();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table chair_workspaces(id uuid primary key);");
    await db.query("insert into chair_workspaces values($1),($2)",[w,other]);
    const sql=await readFile(new URL("../sql/webhook-jobs.sql",import.meta.url),"utf8");
    await db.exec(sql); await db.exec(sql);
    const payload={ref:"refs/heads/main",before:"a".repeat(40),after:"b".repeat(40),repository:{id:42}};
    const enqueue=async(workspace=w,delivery="one",p=payload)=>(await db.query<{id:string}>("select chair_enqueue_webhook($1,$2,$3) id",[workspace,delivery,JSON.stringify(p)])).rows[0].id;
    const claim=async(id:string|null=null)=>(await db.query<{job:any}>("select chair_claim_webhook($1) job",[id])).rows[0].job;
    const finish=async(job:any,ok:boolean)=>(await db.query<{ok:boolean}>("select chair_finish_webhook($1,$2,$3) ok",[job.id,job.lease_token,ok])).rows[0].ok;
    for(const role of ["anon","authenticated"]){
      await db.exec(`set role ${role}`);
      await assert.rejects(enqueue(),/permission denied/);
      await assert.rejects(claim(),/permission denied/);
      await assert.rejects(db.query("select * from chair_webhook_jobs"),/permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const id=await enqueue(); assert.equal(await enqueue(),id);
    await assert.rejects(enqueue(w,"one",{...payload,after:"c".repeat(40)}),/Delivery payload changed/);
    assert.notEqual(await enqueue(other),id,"same delivery in another workspace is separate");
    const first=await claim(id); assert.equal(first.attempts,1); assert.equal(await claim(id),null,"active lease prevents duplicate work");
    await db.query("update chair_webhook_jobs set lease_until=now()-interval '1 second' where id=$1",[id]);
    const recovered=await claim(id); assert.equal(recovered.attempts,2); assert.notEqual(recovered.lease_token,first.lease_token);
    assert.equal(await finish(first,true),false,"stale worker cannot finalize a new lease");
    assert.equal(await finish(recovered,false),true);
    assert.equal(await claim(id),null,"retry backoff is enforced");
    await db.query("update chair_webhook_jobs set available_at=now(),attempts=7 where id=$1",[id]);
    const final=await claim(id); assert.equal(final.attempts,8); assert.equal(await finish(final,false),true);
    assert.equal(await claim(id),null,"dead letters stop automatic retry");
    assert.equal((await db.query<{status:string}>("select status from chair_webhook_jobs where id=$1",[id])).rows[0].status,"failed");
    await db.query("select chair_retry_webhook($1)",[id]);
    const retry=await claim(id); assert.equal(retry.attempts,1); await finish(retry,true);
    assert.equal(await claim(id),null); assert.equal(await enqueue(),id,"completed jobs stay deduplicated");
    await db.query("insert into chair_webhook_jobs(workspace_id,delivery_id,payload) select $1,'backlog-'||n,'{}'::jsonb from generate_series(1,100)n",[w]);
    await assert.rejects(enqueue(w,"full"),/Webhook capacity reached/);
    assert.equal(await enqueue(),id,"capacity does not prevent confirming a prior delivery");
  } finally { await db.close(); }
});
