// Disposable integration check. No existing projects are edited and no emails are sent.
// node --env-file=web/.env.local --import tsx web/scripts/check-project-info.ts
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import sharp from "sharp";

const url=process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key=process.env.SUPABASE_SERVICE_KEY!;
const browserKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const origin=process.env.WORKSPACE_CHECK_URL ?? "http://localhost:3000";
if(!url || !key || !browserKey)throw new Error("Load the local Supabase environment first.");
const network={fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})};
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:network});
const users:string[]=[],spaces:string[]=[];
async function account(){
  const email=`chair-project-check-${randomBytes(10).toString('hex')}@example.com`,password=randomBytes(32).toString('base64url');
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{displayName:'Project check'}});
  if(created.error || !created.data.user)throw new Error('Could not create disposable account.');
  users.push(created.data.user.id);
  const client=createClient(url,browserKey,{auth:{persistSession:false,autoRefreshToken:false},global:network});
  const signed=await client.auth.signInWithPassword({email,password});
  if(signed.error || !signed.data.session)throw new Error('Could not sign in disposable account.');
  return {id:created.data.user.id,token:signed.data.session.access_token};
}
async function request(path:string,token?:string,body?:object|FormData){
  const multipart=body instanceof FormData;
  return fetch(origin+path,{method:body?'POST':'GET',headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(body && !multipart?{'content-type':'application/json'}:{})},
    body:multipart?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
}
async function main() {
try {
  const owner=await account(),member=await account(),other=await account();
  const created=await request('/api/workspaces',owner.token,{name:`Project check ${randomBytes(4).toString('hex')}`});
  assert.equal(created.status,200);
  const {workspace}=await created.json();spaces.push(workspace.id);
  const joined=await admin.from('chair_memberships').insert({workspace_id:workspace.id,user_id:member.id,display_name:'Member check',role:'member'});
  if(joined.error)throw new Error('Could not add disposable member.');
  const base=`/api/workspaces/${workspace.id}/project`;
  assert.equal((await request(base)).status,401);
  const initial=await request(base,owner.token);assert.equal(initial.status,200);
  const {project}=await initial.json();assert(project.slug);
  const image=await sharp({create:{width:8,height:8,channels:3,background:'#5060ff'}}).png().toBuffer();
  const uploadId=randomUUID();
  const form=()=>{const value=new FormData();value.set('clientUploadId',uploadId);value.set('file',new File([new Uint8Array(image)],'check.png',{type:'image/png'}));return value;};
  assert.equal((await request(base+'/images',member.token,form())).status,403);
  const uploaded=await request(base+'/images',owner.token,form());assert.equal(uploaded.status,200);
  const attachment=(await uploaded.json()).image;
  const retried=await request(base+'/images',owner.token,form());assert.equal(retried.status,200);assert.equal((await retried.json()).image.id,attachment.id);
  assert.equal((await request(base+'/images/'+attachment.id,member.token)).status,404);
  const body={name:'Renamed disposable project',description:'## Plan\n- Build\n- Test\n[Link](https://example.com)',hackathonMode:true,deadline:'2027-01-01T17:00:00Z',imageIds:[attachment.id],revision:project.revision};
  const saved=await request(base,owner.token,body);assert.equal(saved.status,200);
  const updated=(await saved.json()).project;assert.equal(updated.slug,project.slug);assert.equal(updated.images.length,1);
  const stale=await request(base,owner.token,body);
  assert.equal(stale.status,409);
  assert.equal((await request(base,member.token,{...body,revision:updated.revision})).status,403);
  assert.equal((await request(base,member.token)).status,200);
  const viewed=await request(base+'/images/'+attachment.id,member.token);assert.equal(viewed.status,200);assert.equal(viewed.headers.get('content-type'),'image/webp');
  assert.equal((await request(base,other.token)).status,404);
  assert.equal((await request(base+'/images/'+attachment.id,other.token)).status,404);
  const listed=await request('/api/workspaces',owner.token);assert.equal(listed.status,200);
  assert.equal((await listed.json()).workspaces.find((w:any)=>w.id===workspace.id).slug,project.slug);
  console.log('PASS: real project save/read, stable rename links, owner restrictions, image upload/retry/view, shared deadline, stale revisions and workspace isolation.');
} finally {
  let cleanupFailed=false;
  for(const id of spaces){
    const images=await admin.from('chair_project_images').select('object_path').eq('workspace_id',id);
    if(images.error){cleanupFailed=true;continue;}
    const paths=images.data.map(image=>image.object_path as string);
    if(paths.some(path=>!path.startsWith(id+'/'))){cleanupFailed=true;continue;}
    if(paths.length && (await admin.storage.from('chair-project-images').remove(paths)).error){cleanupFailed=true;continue;}
    if((await admin.from('chair_workspaces').delete().eq('id',id)).error)cleanupFailed=true;
  }
  for(const id of users)if((await admin.auth.admin.deleteUser(id)).error)cleanupFailed=true;
  if(cleanupFailed)throw new Error('Disposable test cleanup needs attention.');
  console.log('Disposable test records and image objects removed.');
}
}
void main().catch(error=>{console.error(error instanceof Error ? error.message : 'Project check failed.');process.exitCode=1;});
