import test from 'node:test';
import assert from 'node:assert/strict';
import {removeWorkspaceFiles} from './workspace-delete';

test('file cleanup retains retry records on storage failure and removes only queued paths',async t=>{
 const previous={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_KEY};
 process.env.SUPABASE_URL='https://cleanup.invalid';process.env.SUPABASE_SERVICE_KEY='test-key';
 t.after(()=>{for(const [key,value] of [['SUPABASE_URL',previous.url],['SUPABASE_SERVICE_KEY',previous.key]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const workspace='10000000-0000-4000-8000-000000000001';
 const row={id:'20000000-0000-4000-8000-000000000001',workspace_id:workspace,bucket:'chair-chat-images',object_path:workspace+'/u/image.webp'};
 let failure=true,removedRecords=0;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=new URL(String(input)).pathname;
  if(path.startsWith('/storage/')){
   assert.equal(path,'/storage/v1/object/chair-chat-images');
   assert.deepEqual(JSON.parse(String(init?.body)).prefixes,[row.object_path]);
   return failure?Response.json({message:'outage'},{status:503}):Response.json([]);
  }
  assert.equal(path,'/rest/v1/chair_file_removals');
  if(init?.method==='DELETE'){removedRecords++;return new Response(null,{status:204});}
  return Response.json([row]);
 });
 assert.deepEqual(await removeWorkspaceFiles(),{processed:0,failed:1});assert.equal(removedRecords,0);
 failure=false;
 assert.deepEqual(await removeWorkspaceFiles(),{processed:1,failed:0});assert.equal(removedRecords,1);
});
