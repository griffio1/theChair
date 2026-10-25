import test from "node:test";
import assert from "node:assert/strict";
import { enqueuePush, processWebhookJob, schedulerAuthorized } from "./webhook-jobs";
import { GET } from "../app/api/internal/jobs/route";

test("job runner rejects missing, short and wrong credentials before touching storage",async(t)=>{
  const secret="a".repeat(48);
  assert.equal(schedulerAuthorized(null,secret),false);
  assert.equal(schedulerAuthorized(`Bearer ${secret}`,""),false);
  assert.equal(schedulerAuthorized("Bearer short","short"),false);
  assert.equal(schedulerAuthorized(`Bearer ${"b".repeat(48)}`,secret),false);
  assert.equal(schedulerAuthorized(`Bearer ${secret}`,secret),true);
  const old=process.env.CRON_SECRET; process.env.CRON_SECRET=secret;
  t.after(()=>{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;});
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("Must not reach storage");});
  const response=await GET(new Request("http://localhost/api/internal/jobs"));
  assert.equal(response.status,401); assert.match(response.headers.get("cache-control")??"",/no-store/);
});

test("queue acknowledgement requires durable storage and never saves unrelated push data",async(t)=>{
  const vars={SUPABASE_URL:"https://database.invalid",SUPABASE_SERVICE_KEY:"test-only-service-key"};
  const old={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_KEY:process.env.SUPABASE_SERVICE_KEY};
  Object.assign(process.env,vars);
  t.after(()=>{for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  let fail=false;
  t.mock.method(globalThis,"fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
    assert.ok(String(input).endsWith("/rpc/chair_enqueue_webhook"));
    const body=JSON.parse(String(init?.body));
    assert.equal(body.p_workspace,"10000000-0000-4000-8000-000000000001");
    assert.equal(body.p_payload.head_commit.message.length,1000);
    assert.ok(!JSON.stringify(body).includes("do-not-store"));
    assert.equal(body.p_delivery.length,64);
    return fail?Response.json({code:"PGRST202"},{status:404}):Response.json("20000000-0000-4000-8000-000000000001");
  });
  const payload={repository:{id:42,token:"do-not-store"},ref:"refs/heads/main",before:"a".repeat(40),after:"b".repeat(40),head_commit:{message:"x".repeat(2000)},extra:"do-not-store"};
  assert.equal(await enqueuePush("10000000-0000-4000-8000-000000000001",payload),"20000000-0000-4000-8000-000000000001");
  fail=true; await assert.rejects(enqueuePush("10000000-0000-4000-8000-000000000001",payload),/could not be saved/);
});

test("worker completes saved checks and records failures without discarding the job",async(t)=>{
  const previous={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_KEY:process.env.SUPABASE_SERVICE_KEY};
  Object.assign(process.env,{SUPABASE_URL:"https://database.invalid",SUPABASE_SERVICE_KEY:"test-only-service-key"});
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const workspace="10000000-0000-4000-8000-000000000001";
  let failure=false; const results:boolean[]=[];
  t.mock.method(console,"error",()=>{});
  t.mock.method(globalThis,"fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith("/rpc/chair_claim_webhook")) return Response.json({id:"20000000-0000-4000-8000-000000000001",workspace_id:workspace,lease_token:"30000000-0000-4000-8000-000000000001",payload:{repository:{id:42},ref:"refs/heads/main",before:"a".repeat(40),after:"b".repeat(40)}});
    if(url.pathname.endsWith("/rpc/chair_finish_webhook")){results.push(JSON.parse(String(init?.body)).p_ok);return Response.json(true);}
    if(url.pathname.endsWith("/chair_repository_connections"))return Response.json([{workspace_id:workspace,repository_id:42,repository:"owner/project",token:"test-github-token",connected_by:"40000000-0000-4000-8000-000000000001"}]);
    if(url.pathname.includes("/compare/"))return failure?Response.json({},{status:503}):Response.json({files:[],total_commits:1});
    if(url.pathname.endsWith("/events"))return Response.json([]);
    if(url.pathname.endsWith("/contracts"))return Response.json([]);
    throw new Error(`Unexpected test request: ${url.pathname}`);
  });
  assert.deepEqual(await processWebhookJob(),{processed:1,failed:0});
  failure=true; assert.deepEqual(await processWebhookJob(),{processed:0,failed:1});
  assert.deepEqual(results,[true,false]);
});
