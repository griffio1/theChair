// Disposable integration check. No existing projects are edited and no emails are sent.
// node --env-file=web/.env.local --import tsx web/scripts/check-usernames-inbox.ts
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
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
  return {id:created.data.user.id,token:signed.data.session.access_token};
}
async function request(path:string,token?:string,body?:object|FormData){
  const multipart=body instanceof FormData;
  return fetch(origin+path,{method:body?'POST':'GET',headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(body && !multipart?{'content-type':'application/json'}:{})},
    body:multipart?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
}
async function main(){try {
 const owner=await account(),member=await account(),other=await account();
 const handle='check_'+randomBytes(8).toString('hex');
 assert.equal((await request('/api/account/profile')).status,401);
 let r=await request('/api/account/profile',member.token,{displayName:'Invite check',username:handle});assert.equal(r.status,200);assert.equal((await r.json()).profile.username,handle);
 assert.equal((await request('/api/account/profile',other.token,{displayName:'Other',username:handle.toUpperCase()})).status,409);
 assert.equal((await (await request('/api/usernames/'+handle)).json()).available,false);
 r=await request('/api/workspaces',owner.token,{name:'Disposable username check'});assert.equal(r.status,200);const {workspace}=await r.json();spaces.push(workspace.id);
 const path='/api/workspaces/'+workspace.id+'/invitations';
 r=await request(path,owner.token,{username:'@'+handle});assert.equal(r.status,200);const {invitation}=await r.json();assert(invitation.inviteUrl);assert(!invitation.email);
 r=await request(path,owner.token,{username:handle});assert.equal(r.status,200);assert.equal((await r.json()).invitation.id,invitation.id);
 r=await request('/api/notifications',member.token);assert.equal(r.status,200);const inbox=await r.json();assert.equal(inbox.unreadCount,1);assert.equal(inbox.notifications[0].id,invitation.id);
 assert.equal((await (await request('/api/notifications',other.token)).json()).notifications.length,0);
 assert.equal((await request('/api/invitations/'+invitation.id+'/respond',other.token,{action:'accept'})).status,403);
 r=await request('/api/notifications/read',member.token,{notificationIds:[invitation.id]});assert.equal(r.status,200);assert.equal((await r.json()).unreadCount,0);
 assert.equal((await request('/api/account/profile',member.token,{displayName:'Renamed',username:handle+'_x'})).status,200);
 r=await request('/api/invitations/'+invitation.id+'/respond',member.token,{action:'accept'});assert.equal(r.status,200);assert.equal((await r.json()).workspaceId,workspace.id);
 r=await request('/api/workspaces/'+workspace.id,member.token);assert.equal(r.status,200);assert((await r.json()).members.some((m:any)=>m.userId===member.id&&m.username===handle+'_x'&&m.role==='member'));
 const otherHandle='check_'+randomBytes(8).toString('hex');
 assert.equal((await request('/api/account/profile',other.token,{displayName:'Other',username:otherHandle})).status,200);
 r=await request(path,owner.token,{username:otherHandle});assert.equal(r.status,200);const declined=(await r.json()).invitation;
 assert.equal((await request('/api/invitations/'+declined.id+'/respond',other.token,{action:'decline'})).status,200);
 assert.equal((await request('/api/workspaces/'+workspace.id,other.token)).status,404);
 console.log('PASS: live profile updates, unique usernames, private inbox, unread counts, duplicate invites, rename-safe acceptance, member permissions and decline.');
}finally{
 let failed=false;
 for(const id of spaces)if((await admin.from('chair_workspaces').delete().eq('id',id)).error)failed=true;
 for(const id of users)if((await admin.auth.admin.deleteUser(id)).error)failed=true;
 if(failed)throw new Error('Disposable cleanup needs attention.');
 console.log('Disposable accounts and workspace removed.');
}}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Check failed');process.exitCode=1;});
