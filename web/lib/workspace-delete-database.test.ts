import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('workspace deletion requires an owner and exact name, cascades data and retains private cleanup paths',async()=>{
 const db=new PGlite(),owner=randomUUID(),member=randomUUID(),outsider=randomUUID();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for(const id of [owner,member,outsider])await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.com']);
  await db.exec(await readFile(new URL('../sql/workspaces.sql',import.meta.url),'utf8'));
  await db.exec(`create table messages(id uuid primary key default gen_random_uuid(),workspace_id uuid references chair_workspaces(id) on delete cascade,body text);
    create table chair_legacy_binding(workspace_id uuid references chair_workspaces(id));`);
  for(const file of ['chat-images.sql','project-info.sql','workspace-delete.sql','workspace-delete.sql'])await db.exec(await readFile(new URL('../sql/'+file,import.meta.url),'utf8'));
  const as=async(id:string)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
  await as(owner);
  const first=(await db.query<any>("select chair_create_workspace('Delete me') w")).rows[0].w;
  const second=(await db.query<any>("select chair_create_workspace('Keep me') w")).rows[0].w;
  const w=first.workspace.id;
  await db.exec('reset role');
  await db.query("insert into chair_memberships(workspace_id,user_id,display_name,role) values($1,$2,'Member','member')",[w,member]);
  await db.query('insert into chair_legacy_binding values($1)',[w]);
  await db.query("insert into messages(workspace_id,body) values($1,'Private chat')",[w]);
  for(const table of ['chair_chat_images','chair_project_images'])await db.query(`insert into ${table}(workspace_id,uploaded_by,client_upload_id,name,width,height,size,content_hash,object_path,ready) values($1,$2,$3,'Image',1,1,20,'hash',$4,true)`,[w,owner,randomUUID(),w+'/'+owner+'/'+randomUUID()+'.webp']);
  const remove=(name='Delete me')=>db.query('select chair_delete_workspace($1,$2)',[w,name]);
  await as(member);await assert.rejects(remove(),(e:any)=>e.code==='42501');
  await as(outsider);await assert.rejects(remove());
  await as(owner);await assert.rejects(remove('delete me'),(e:any)=>e.code==='22023');
  await assert.rejects(db.exec('select * from chair_file_removals'));
  await remove();await assert.rejects(remove());
  assert.equal((await db.query('select id from chair_workspaces')).rows.length,1);
  await db.exec('reset role');
  for(const table of ['chair_memberships','chair_chats','chair_chat_images','chair_project_images','messages','chair_legacy_binding'])assert.equal((await db.query(`select * from ${table} where workspace_id=$1`,[w])).rows.length,0);
  assert.equal((await db.query('select id from chair_workspaces where id=$1',[second.workspace.id])).rows.length,1);
  const paths=(await db.query<any>('select * from chair_file_removals')).rows;
  assert.equal(paths.length,2);assert(paths.every(p=>p.object_path.startsWith(w+'/')&&new Date(p.available_at)>new Date()));
  await db.exec('set role anon');await assert.rejects(db.query('select chair_delete_workspace($1,$2)',[second.workspace.id,'Keep me']));
 }finally{await db.close();}
});
