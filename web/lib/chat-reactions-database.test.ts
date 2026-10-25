import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("reactions are shared, retry-safe, owned by the caller and isolated by conversation", async () => {
  const db = new PGlite();
  const owner = randomUUID(), member = randomUUID(), outsider = randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      create table messages(id uuid primary key default gen_random_uuid(),workspace_id uuid,created_at timestamptz default now());`);
    for(const id of [owner,member,outsider]) await db.query("insert into auth.users(id,email) values($1,'test@example.com')",[id]);
    await db.exec(await readFile(new URL("../sql/workspaces.sql",import.meta.url),"utf8"));
    const sql = await readFile(new URL("../sql/chat-reactions.sql",import.meta.url),"utf8");
    await db.exec(sql); await db.exec(sql);
    async function asUser(id:string) {
      await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec("set role authenticated");
    }
    await asUser(owner);
    const first=(await db.query<{w:any}>("select chair_create_workspace('First') as w")).rows[0].w;
    const other=(await db.query<{w:any}>("select chair_create_workspace('Other') as w")).rows[0].w;
    const w=first.workspace.id,c=first.chat.id;
    const message=(await db.query<{id:string}>("select id from chair_send_message($1,$2,'Hello',$3)",[w,c,randomUUID()])).rows[0].id;
    const foreign=(await db.query<{id:string}>("select id from chair_send_message($1,$2,'Other',$3)",[other.workspace.id,other.chat.id,randomUUID()])).rows[0].id;
    await db.exec("reset role");
    await db.query("insert into chair_memberships(workspace_id,user_id,display_name,role) values($1,$2,'Member','member')",[w,member]);
    const team=(await db.query<{id:string}>("insert into messages(workspace_id) values($1) returning id",[w])).rows[0].id;
    const set=async (id=message,chat:string|null=c,emoji="👍",active=true)=>(await db.query<{r:any[]}>("select chair_set_reaction($1,$2,$3,$4,$5) as r",[w,chat,id,emoji,active])).rows[0].r;
    await asUser(owner);
    assert.equal((await set())[0].count,1);
    assert.equal((await set())[0].count,1,"retry must not add another reaction");
    await assert.rejects(set(foreign),/Message unavailable/);
    await assert.rejects(set(message,other.chat.id),/Message unavailable/);
    await assert.rejects(set(message,null),/Message unavailable/);
    await assert.rejects(set(message,c,"invalid"),/Invalid reaction/);
    await asUser(member);
    const shared=await set(); assert.equal(shared[0].count,2); assert.equal(shared[0].reactedByMe,true); assert.equal(shared[0].people.length,2);
    assert.equal((await set(message,c,"👍",false))[0].count,1,"removes only current user's reaction");
    assert.equal((await set(message,c,"👍",false))[0].reactedByMe,false);
    assert.equal((await set(team,null,"🎉"))[0].messageId,team);
    assert.equal((await db.query<{r:any[]}>("select chair_read_reactions($1,$2) as r",[w,c])).rows[0].r.length,1);
    assert.equal((await db.query<{r:any[]}>("select chair_read_reactions($1,null) as r",[w])).rows[0].r[0].emoji,"🎉");
    await assert.rejects(db.query("delete from chair_message_reactions"),/permission denied/);
    await asUser(outsider);
    assert.equal((await db.query("select * from chair_message_reactions")).rows.length,0);
    await assert.rejects(set(),/Workspace unavailable/);
    await assert.rejects(db.query("select chair_read_reactions($1,$2)",[w,c]),/Workspace unavailable/);
    await db.exec("reset role"); await db.query("delete from chair_memberships where workspace_id=$1 and user_id=$2",[w,member]);
    await asUser(member); await assert.rejects(set(),/Workspace unavailable/);
    await db.exec("reset role; set role anon"); await assert.rejects(set(),/permission denied/);
  } finally { await db.close(); }
});
