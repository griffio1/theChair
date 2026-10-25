import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

test("profile changes sync only the user's memberships, preserving roles, history and access rules", async () => {
  const db=new PGlite();
  const owner="10000000-0000-4000-8000-000000000001", other="10000000-0000-4000-8000-000000000002";
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated;`);
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'carter@example.com','{\"displayName\":\"Carter\"}'),($2,'other@example.com','{\"displayName\":\"Other\"}')",[owner,other]);
    await db.exec(await readFile(new URL("../sql/workspaces.sql",import.meta.url),"utf8"));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    const first=(await db.query<{w:any}>("select chair_create_workspace('First') as w")).rows[0].w;
    const second=(await db.query<{w:any}>("select chair_create_workspace('Second') as w")).rows[0].w;
    await db.query("insert into chair_memberships(workspace_id,user_id,display_name,role) values($1,$2,'Other','member')",[first.workspace.id,other]);
    await db.query("select chair_send_message($1,$2,'Before rename',gen_random_uuid())",[first.workspace.id,first.chat.id]);
    const sql=await readFile(new URL("../sql/account-profiles.sql",import.meta.url),"utf8");
    await db.exec(sql); await db.exec(sql);
    await db.query("update auth.users set raw_user_meta_data=$1 where id=$2",[JSON.stringify({displayName:"Carter de Streel",nickname:"  CJ  ",role:"owner"}),owner]);
    assert.deepEqual((await db.query("select distinct display_name,role from chair_memberships where user_id=$1",[owner])).rows,[{display_name:"CJ",role:"owner"}]);
    assert.equal((await db.query<{display_name:string}>("select display_name from chair_memberships where user_id=$1",[other])).rows[0].display_name,"Other");
    assert.equal((await db.query<{author_name:string}>("select author_name from chair_messages")).rows[0].author_name,"Carter");
    await db.query("select chair_send_message($1,$2,'After rename',gen_random_uuid())",[first.workspace.id,first.chat.id]);
    assert.equal((await db.query<{author_name:string}>("select author_name from chair_messages where body='After rename'")).rows[0].author_name,"CJ");
    const third=(await db.query<{w:any}>("select chair_create_workspace('Third') as w")).rows[0].w;
    assert.equal((await db.query<{display_name:string}>("select display_name from chair_memberships where workspace_id=$1",[third.workspace.id])).rows[0].display_name,"CJ");
    await db.query("update auth.users set raw_user_meta_data=$1 where id=$2",[JSON.stringify({displayName:"Carter de Streel",nickname:""}),owner]);
    assert.equal((await db.query<{display_name:string}>("select display_name from chair_memberships where workspace_id=$1 and user_id=$2",[second.workspace.id,owner])).rows[0].display_name,"Carter de Streel");
    await db.query("update auth.users set raw_user_meta_data=$1 where id=$2",[JSON.stringify({nickname:{role:"owner"},displayName:["Invalid"]}),other]);
    assert.deepEqual((await db.query("select display_name,role from chair_memberships where user_id=$1",[other])).rows,[{display_name:"other",role:"member"}]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("update chair_memberships set role='owner' where user_id=$1",[other]));
    await assert.rejects(db.exec("select chair_profile_label('{}','secret@example.com')"));
    await assert.rejects(db.query("update auth.users set raw_user_meta_data='{}' where id=$1",[other]));
  } finally {await db.close();}
});
