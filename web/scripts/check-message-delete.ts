// Disposable integration check. No existing projects are edited and no emails are sent.
// node --env-file=web/.env.local --import tsx web/scripts/check-message-delete.ts
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";


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
  return {id:created.data.user.id,token:signed.data.session.access_token,session:signed.data.session};
}
async function request(path:string,token?:string,body?:object|FormData){
  const multipart=body instanceof FormData;
  return fetch(origin+path,{method:body?'POST':'GET',headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(body && !multipart?{'content-type':'application/json'}:{})},
    body:multipart?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
}
async function main(){try {
 const owner=await account(),other=await account();
 const created=await request('/api/workspaces',owner.token,{name:'Disposable deletion check'});assert.equal(created.status,200);
 const {workspace,chat}=await created.json();spaces.push(workspace.id);
 assert(!(await admin.from('chair_memberships').insert({workspace_id:workspace.id,user_id:other.id,display_name:'Other',role:'member'})).error);
 const messages='/api/workspaces/'+workspace.id+'/chats/'+chat.id+'/messages';
 const sent=await request(messages,owner.token,{body:'Delete check',clientMessageId:randomUUID()});assert.equal(sent.status,200);
 const message=(await sent.json()).messages.find((m:any)=>m.body==='Delete check');assert(message);
 const path='/api/workspaces/'+workspace.id+'/conversations/'+chat.id+'/messages/'+message.id;
 const remove=(token?:string)=>fetch(origin+path,{method:'DELETE',headers:token?{authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(20000)});
 assert.equal((await remove()).status,401);assert.equal((await remove(other.token)).status,403);
 assert.equal((await request(path+'/reactions',other.token,{emoji:'\u{1f44d}',active:true})).status,200);
 assert.equal((await remove(owner.token)).status,200);assert.equal((await remove(owner.token)).status,200);
 const rows=(await (await request(messages,owner.token)).json()).messages;
 const deleted=rows.find((m:any)=>m.id===message.id);assert.equal(deleted.body,'Message deleted');assert(deleted.deletedAt);assert.deepEqual(deleted.images,[]);
 const teamId=randomUUID(),issueId=randomUUID();
 assert(!(await admin.from('messages').insert([{id:teamId,workspace_id:workspace.id,author_type:'human',author_name:'Project check',author_user_id:owner.id,kind:'text',body:'Delete team check'},{id:issueId,workspace_id:workspace.id,author_type:'system',author_name:'Project check',author_user_id:owner.id,kind:'text',body:'Protected system check'}])).error);
 const teamDelete=(id:string,token:string)=>fetch(origin+'/api/workspaces/'+workspace.id+'/conversations/team/messages/'+id,{method:'DELETE',headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
 assert.equal((await teamDelete(teamId,other.token)).status,403);assert.equal((await teamDelete(issueId,owner.token)).status,403);assert.equal((await teamDelete(teamId,owner.token)).status,200);
 console.log('PASS: live author-only deletion, repeated requests, deleted placeholders, team chat and protected system messages.');
}finally{
 let failed=false;
 for(const id of spaces)if((await admin.from('chair_workspaces').delete().eq('id',id)).error)failed=true;
 for(const id of users)if((await admin.auth.admin.deleteUser(id)).error)failed=true;
 if(failed)throw new Error('Disposable cleanup needs attention.');
 console.log('Disposable records removed.');
}}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Check failed');process.exitCode=1;});
