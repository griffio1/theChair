import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("image SQL protects drafts, isolates workspaces, and atomically deduplicates attachments", async () => {
  const db = new PGlite();
  const owner = randomUUID(), member = randomUUID(), outsider = randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table public.messages(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,author_type text,author_name text,kind text,body text,created_at timestamptz default now());`);
    for (const id of [owner, member, outsider]) await db.query("insert into auth.users(id,email) values($1,'test@example.com')", [id]);
    await db.exec(await readFile(new URL("../sql/workspaces.sql", import.meta.url), "utf8"));
    const sql = await readFile(new URL("../sql/chat-images.sql", import.meta.url), "utf8");
    await db.exec(sql); await db.exec(sql);
    const asUser = async (id: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
      await db.exec("set role authenticated");
    };
    await asUser(owner);
    const first = (await db.query<{w:any}>("select chair_create_workspace('One') as w")).rows[0].w;
    const second = (await db.query<{w:any}>("select chair_create_workspace('Two') as w")).rows[0].w;
    const w = first.workspace.id, chat = first.chat.id;
    await db.exec("reset role");
    await db.query("insert into chair_memberships(workspace_id,user_id,display_name,role) values($1,$2,'Member','member')", [w,member]);
    const image = async (workspace = w, uploader = owner, ready = true) => {
      await db.exec("reset role");
      const id = randomUUID();
      await db.query(`insert into chair_chat_images(id,workspace_id,uploaded_by,client_upload_id,name,width,height,size,content_hash,object_path,ready)
        values($1::uuid,$2,$3,$4,'test.webp',10,10,100,'hash',($1::uuid)::text,true)`, [id,workspace,uploader,randomUUID()]);
      if (!ready) await db.query("update chair_chat_images set ready=false where id=$1", [id]);
      return id;
    };
    const own = await image(), others = await image(w,member), cross = await image(second.workspace.id), unfinished = await image(w,owner,false);
    await asUser(member);
    assert.deepEqual((await db.query("select id from chair_chat_images")).rows.map((r:any)=>r.id),[others]);
    await asUser(owner);
    const send = (ids: string[], body = "", client = randomUUID(), target: string | null = chat) => db.query<{m:any}>(
      "select chair_send_images($1,$2,$3,$4,$5::uuid[]) as m", [w,target,body,client,ids]);
    for (const invalid of [[others],[cross],[unfinished],[own,own]]) await assert.rejects(send(invalid));
    await assert.rejects(send([], ""));
    const retry = randomUUID();
    const posted = (await send([own], "", retry)).rows[0].m;
    assert.equal(posted.images[0].id, own);
    assert.equal((await send([own], "", retry)).rows[0].m.id,posted.id);
    await assert.rejects(send([own], "changed", retry), /Retry payload changed/);
    await assert.rejects(send([own]), /Image unavailable/);
    assert.equal((await send([], "Text still works")).rows[0].m.body,"Text still works");
    await asUser(member);
    assert.equal((await db.query("select id from chair_chat_images where id=$1",[own])).rows.length,1);
    await assert.rejects(send([others],"",randomUUID(),second.chat.id), /Chat unavailable/);
    const team = (await send([others], "Team caption", retry, null)).rows[0].m;
    assert.equal((await send([others], "Team caption", retry, null)).rows[0].m.id,team.id);
    await assert.rejects(send([others],"Team caption",randomUUID(),null),/Image unavailable/);
    await assert.rejects(db.query("update chair_chat_images set ready=false where id=$1",[others]),/permission denied/);
    await asUser(outsider);
    assert.equal((await db.query("select * from chair_chat_images")).rows.length,0);
    await assert.rejects(send([own]), /Workspace unavailable/);
    await db.exec("reset role");
    await db.query("delete from chair_memberships where workspace_id=$1 and user_id=$2",[w,member]);
    await asUser(member);
    assert.equal((await db.query("select * from chair_chat_images")).rows.length,0);
    await db.exec("reset role; set role anon");
    await assert.rejects(db.query("select * from chair_chat_images"), /permission denied/);
    await assert.rejects(send([own]), /permission denied/);
  } finally { await db.close(); }
});
