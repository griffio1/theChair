import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const zero = "00000000-0000-0000-0000-000000000000";
const code = (expected: string) => (error: unknown) => (error as {code?:string}).code === expected;
async function fixture() {
  const db = new PGlite();
  const owner = randomUUID(), member = randomUUID(), outsider = randomUUID(), unconfirmed = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table public.messages(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,author_type text,author_name text,kind text,body text,created_at timestamptz default now());
    create table public.chair_agent_credentials(id uuid primary key default gen_random_uuid(),workspace_id uuid,issued_by uuid,label text,token_hash text,expires_at timestamptz,revoked_at timestamptz);
    grant all on public.chair_agent_credentials to service_role;`);
  for (const id of [owner, member, outsider, unconfirmed])
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [id, `${id}@example.com`, id === unconfirmed ? null : new Date()]);
  for (const file of ["workspaces.sql", "chat-images.sql", "chat-reactions.sql"])
    await db.exec(await readFile(new URL(`../sql/${file}`, import.meta.url), "utf8"));
  async function asAdmin() {
    await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
  }
  async function asUser(id = owner) {
    await asAdmin(); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    await db.exec("set role authenticated");
  }
  async function asService() { await asAdmin(); await db.exec("set role service_role"); }
  await asUser();
  const initial = (await db.query<{w:any}>("select chair_create_workspace('Existing') as w")).rows[0].w;
  const w = initial.workspace.id as string, chat = initial.chat.id as string;
  await asAdmin();
  await db.query("insert into chair_memberships(workspace_id,user_id,display_name,role) values($1,$2,'Member','member')", [w,member]);
  const sql = await readFile(new URL("../sql/production-limits.sql", import.meta.url), "utf8");
  await db.exec(sql); await db.exec(sql);
  async function seed(action: string, seconds: number, used: number, actor: string = zero, workspace: string = w) {
    await asAdmin();
    await db.query(`insert into chair_usage_windows(action,workspace_id,actor_id,window_start,expires_at,used)
      values($1,$2,$3,to_timestamp(floor(extract(epoch from clock_timestamp())/$4)*$4),now()+interval '1 day',$5)
      on conflict(action,workspace_id,actor_id,window_start) do update set used=excluded.used`,
    [`${action}:${seconds}`,workspace,actor,seconds,used]);
  }
  async function clear() { await asAdmin(); await db.exec("delete from chair_usage_windows"); }
  async function count(table: string) { await asAdmin(); return Number((await db.query<{n:string}>(`select count(*) as n from ${table}`)).rows[0].n); }
  const send = (client = randomUUID()) => db.query<{id:string}>("select id from chair_send_message($1,$2,'Hello',$3)",[w,chat,client]);
  const image = (size = 100, uploader = owner) => db.query<{id:string}>(`insert into chair_chat_images(workspace_id,uploaded_by,client_upload_id,name,width,height,size,content_hash,object_path,ready)
    values($1,$2,$3,'photo.webp',10,10,$4,'hash',$5,true) returning id`,[w,uploader,randomUUID(),size,randomUUID()]);
  return {db,owner,member,outsider,unconfirmed,w,chat,asAdmin,asUser,asService,seed,clear,count,send,image};
}

test("workspace quotas protect direct RPCs, require confirmed email, and keep private counters private", async () => {
  const f = await fixture(); const {db} = f;
  try {
    assert.equal(await f.count("chair_workspaces"),1,"reapplying migration preserves existing workspaces");
    await f.asUser(f.unconfirmed);
    await assert.rejects(db.query("select chair_create_workspace('Unconfirmed')"), /Confirm your email/);
    await f.asUser();
    for (let i=0;i<10;i++) await db.query("select chair_create_workspace('Allowed')");
    await assert.rejects(db.query("select chair_create_workspace('Too soon')"),code("PT429"));
    assert.equal(await f.count("chair_workspaces"),11,"rejected create rolls back workspace, membership and General chat");
    await f.clear(); await f.asUser();
    for (let i=0;i<9;i++) await db.query("select chair_create_workspace('Allowed')");
    await assert.rejects(db.query("select chair_create_workspace('Over total')"),/20 workspace limit/);
    assert.equal(await f.count("chair_workspaces"),20);
    await f.seed("workspace_create_site",86400,200,zero,zero); await f.asUser(f.outsider);
    await assert.rejects(db.query("select chair_create_workspace('Site full')"),code("PT429"));
    await assert.rejects(db.query("select * from chair_usage_windows"),/permission denied/);
    await assert.rejects(db.query("delete from chair_usage_windows"),/permission denied/);
    await assert.rejects(db.query("select chair_take_usage(null,null,'bypass',0,100,60)"),/permission denied/);
    await assert.rejects(db.query("select chair_consume_server_budget($1,$2,'ai_chat')",[f.w,f.owner]),/permission denied/);
    await f.asAdmin();
    assert.equal((await db.query("select * from chair_usage_windows where actor_id=$1",[f.outsider])).rows.length,0,"global rejection rolls back personal reservation");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.member]);
    await assert.rejects(db.query("insert into chair_chats(workspace_id,title,created_by) values($1,'Spoof',$2)",[f.w,f.owner]),/Account mismatch/);
  } finally { await db.close(); }
});

test("direct chat, invite, message and reaction writes are bounded without charging retries", async () => {
  const f = await fixture(); const {db} = f;
  try {
    await f.seed("chat_create",3600,30,f.owner); await f.asUser();
    await assert.rejects(db.query("select chair_create_chat($1,'Too many')",[f.w]),code("PT429"));
    assert.equal(await f.count("chair_chats"),1);
    await f.seed("invite_create",3600,19,f.owner); await f.asUser();
    const invite = (hash: string) => db.query("select chair_create_invitation($1,'guest@example.com',$2)",[f.w,hash]);
    await invite("a".repeat(64));
    await invite("a".repeat(64)); // Same hash is a true retry; a replacement link costs another write.
    await assert.rejects(invite("b".repeat(64)),code("PT429"));
    assert.equal(await f.count("chair_invitations"),1);
    await f.clear(); await f.asUser();
    const client = randomUUID(); const message = (await f.send(client)).rows[0].id;
    await f.seed("message_create",60,60,f.owner); await f.asUser();
    assert.equal((await f.send(client)).rows[0].id,message,"retry remains available at the cap");
    await assert.rejects(f.send(),code("PT429"));
    await f.clear(); await f.seed("message_create",86400,2000); await f.asUser();
    await assert.rejects(f.send(),code("PT429"));
    await f.asAdmin();
    assert.equal((await db.query("select * from chair_usage_windows where actor_id=$1",[f.owner])).rows.length,0,"later daily rejection rolls back minute counter");
    assert.equal(await f.count("chair_messages"),1);
    await f.clear(); await f.asUser();
    const react = (active = true) => db.query("select chair_set_reaction($1,$2,$3,'👍',$4)",[f.w,f.chat,message,active]);
    await react(); await f.seed("reaction_create",60,120,f.owner); await f.asUser();
    await react(); await react(false);
    await assert.rejects(react(),code("PT429"));
    assert.equal(await f.count("chair_message_reactions"),0,"removing a reaction stays available at the cap");
  } finally { await db.close(); }
});

test("stored drafts and workspace/site image bytes are reserved before object upload", async () => {
  const f = await fixture(); const {db} = f;
  try {
    for (let i=0;i<20;i++) await f.image();
    await assert.rejects(f.image(),/Too many unsent images/);
    await f.asAdmin(); await db.exec("delete from chair_chat_images"); await f.clear();
    for (let i=0;i<10;i++) await f.image(3145728);
    await assert.rejects(f.image(1),/Too many unsent images/);
    await f.asAdmin(); await db.exec("delete from chair_chat_images; alter table chair_chat_images disable trigger chair_usage_write");
    await db.query(`insert into chair_chat_images(workspace_id,uploaded_by,client_upload_id,name,width,height,size,content_hash,object_path)
      select $1,$2,gen_random_uuid(),'old.webp',1,1,3145728,'hash',gen_random_uuid()::text from generate_series(1,34)`,[f.w,f.member]);
    await db.exec("alter table chair_chat_images enable trigger chair_usage_write");
    await assert.rejects(f.image(),/100 MiB image limit/);
    await db.exec("delete from chair_chat_images; alter table chair_chat_images disable trigger chair_usage_write");
    const other = randomUUID();
    await db.query("insert into chair_workspaces(id,name,created_by) values($1,'Historical',$2)",[other,f.owner]);
    await db.query(`insert into chair_chat_images(workspace_id,uploaded_by,client_upload_id,name,width,height,size,content_hash,object_path)
      select $1,$2,gen_random_uuid(),'old.webp',1,1,3145728,'hash',gen_random_uuid()::text from generate_series(1,683)`,[other,f.owner]);
    await db.exec("alter table chair_chat_images enable trigger chair_usage_write");
    await assert.rejects(f.image(),/Image storage is full/);
    assert.equal(await f.count("chair_chat_images"),683,"over-cap historical files remain intact");
    await f.asService();
    await assert.rejects(f.image(100,f.outsider),/Workspace unavailable/);
  } finally { await db.close(); }
});

test("server budgets serialize calls, share a site AI ceiling, and validate the verified actor", async () => {
  const f = await fixture(); const {db} = f;
  const consume = (actor = f.owner, action = "ai_chat") => db.query("select chair_consume_server_budget($1,$2,$3)",[f.w,actor,action]);
  try {
    await f.asService();
    await assert.rejects(consume(f.outsider),code("42501"));
    await assert.rejects(consume(f.member,"extraction"),code("42501"));
    // PGlite queues one PostgreSQL connection; this checks atomic contention behavior,
    // while the SQL advisory lock also serializes independent production connections.
    const attempts = await Promise.allSettled(Array.from({length:31},()=>consume()));
    assert.equal(attempts.filter(x=>x.status === "fulfilled").length,30);
    assert.equal(attempts.filter(x=>x.status === "rejected" && code("PT429")(x.reason)).length,1);
    await f.clear(); await f.seed("ai_operations_site",86400,499,zero,zero); await f.asService();
    await consume(f.owner,"extraction");
    await assert.rejects(consume(f.member),code("PT429"));
    await f.asAdmin();
    assert.equal((await db.query("select * from chair_usage_windows where actor_id=$1",[f.member])).rows.length,0);
    await db.query("delete from chair_memberships where workspace_id=$1 and user_id=$2",[f.w,f.owner]);
    await f.asService(); await assert.rejects(consume(),code("42501"));
  } finally { await db.close(); }
});

test("AI access key creation is owner-only and bounds active keys even after hourly counters reset", async () => {
  const f = await fixture(); const {db} = f;
  const key = (actor = f.owner) => db.query(`insert into chair_agent_credentials(workspace_id,issued_by,label,token_hash,expires_at)
    values($1,$2,'test',gen_random_uuid()::text,now()+interval '1 day')`,[f.w,actor]);
  try {
    await f.asService(); await assert.rejects(key(f.member),/Owner required/);
    for (let i=0;i<10;i++) await key();
    await assert.rejects(key(),code("PT429"));
    await f.clear(); await f.asService();
    for (let i=0;i<10;i++) await key();
    await assert.rejects(key(),/20 active AI access keys/);
    assert.equal(await f.count("chair_agent_credentials"),20);
    await f.asAdmin(); await db.exec("update chair_agent_credentials set revoked_at=now()");
    await f.clear(); await f.asService(); await key();
    assert.equal(await f.count("chair_agent_credentials"),21,"revoking preserves history and releases an active-key slot");
  } finally { await db.close(); }
});
