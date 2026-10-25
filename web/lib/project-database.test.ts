import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

test("project saves enforce ownership, revisions, private images and stable unique links", async () => {
  const db=new PGlite();
  const owner="10000000-0000-4000-8000-000000000001", member="10000000-0000-4000-8000-000000000002", outsider="10000000-0000-4000-8000-000000000003";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      insert into auth.users(id,email) values('${owner}','owner@test.com'),('${member}','member@test.com'),('${outsider}','other@test.com');`);
    await db.exec(await readFile(new URL('../sql/workspaces.sql',import.meta.url),'utf8'));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    const create=async (name:string)=>(await db.query<{w:any}>("select chair_create_workspace($1) w",[name])).rows[0].w.workspace;
    const first=await create('collegelarper');
    const sql=await readFile(new URL('../sql/project-info.sql',import.meta.url),'utf8');
    await db.exec(sql); await db.exec(sql);
    const second=await create('collegelarper');
    const slugs=(await db.query<{slug:string}>('select slug from chair_workspaces order by created_at,id')).rows.map(r=>r.slug);
    assert(slugs.includes('collegelarper')); assert.equal(new Set(slugs).size,2);
    await db.query("insert into chair_memberships(workspace_id,user_id,display_name,role) values($1,$2,'Member','member')",[first.id,member]);
    const image="20000000-0000-4000-8000-000000000001";
    await db.query("insert into chair_project_images(id,workspace_id,uploaded_by,client_upload_id,name,width,height,size,content_hash,object_path,ready) values($1,$2,$3,gen_random_uuid(),'Picture',10,10,200,'hash','private/picture',true)",[image,first.id,owner]);
    const save=async (space:string,revision:number,images:string[]=[])=>db.query<{p:any}>("select chair_save_project($1,'New name','**Hello**',true,'2027-01-01T17:00:00Z',$2,$3) p",[space,images,revision]);
    await db.exec('set role authenticated');
    const saved=(await save(first.id,0,[image])).rows[0].p;
    assert.equal(saved.workspace.slug,'collegelarper'); assert.equal(saved.workspace.project_revision,1); assert.equal(saved.images.length,1);
    await assert.rejects(save(first.id,0),(error:any)=>error.code==='PT409');
    await assert.rejects(save(second.id,0,[image]));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[member]);
    assert.equal((await db.query('select * from chair_project_images')).rows.length,1);
    await assert.rejects(save(first.id,1));
    await assert.rejects(db.exec("update chair_workspaces set name='Unauthorized'"));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[outsider]);
    assert.equal((await db.query('select * from chair_project_images')).rows.length,0);
    assert.equal((await db.query('select * from chair_workspaces')).rows.length,0);
    await assert.rejects(save(first.id,1));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    await save(first.id,1,[]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[member]);
    assert.equal((await db.query('select * from chair_project_images')).rows.length,0);
  } finally {await db.close();}
});
