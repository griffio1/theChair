import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {authenticate,readBody,textField,validId,WorkspaceError} from './workspace-server';
import {normalizeUsername,usernameError} from './usernames';

export function identityError(error:{code?:string;message?:string}|null){
 if(!error)return;
 if(error.code==='23505')throw new WorkspaceError(409,'That username is taken. Try another.');
 if(error.code==='PT404')throw new WorkspaceError(404,'Username not found. Check the spelling.');
 if(error.code==='PT409')throw new WorkspaceError(409,'This person is already a member.');
 if(error.code==='PT410')throw new WorkspaceError(410,'This invite expired or was already answered.');
 if(error.code==='PT429')throw new WorkspaceError(429,'Too many attempts. Try again later.');
 if(error.code==='42501')throw new WorkspaceError(403,error.message==='Confirm your email first'?'Confirm your email before joining.':'This action is not available for your account.');
 if(error.code==='22023')throw new WorkspaceError(400,'Check your name and username.');
 throw new WorkspaceError(503,'Account services are unavailable. Try again.');
}
export async function profileRequest(req:Request){
 const {db,userId}=await authenticate(req);
 if(req.method==='POST'){
  const body=await readBody(req),displayName=textField(body,'displayName',80,'display name');
  if(typeof body.username!=='string'||usernameError(body.username))throw new WorkspaceError(400,usernameError(typeof body.username==='string'?body.username:''));
  const result=await db.rpc('chair_save_profile',{p_display_name:displayName,p_username:normalizeUsername(body.username)});identityError(result.error);
  return {profile:result.data};
 }
 const result=await db.from('chair_profiles').select('user_id,display_name,username').eq('user_id',userId).maybeSingle();identityError(result.error);
 if(!result.data)throw new WorkspaceError(503,'Account setup is not ready. Try again.');
 return {profile:{userId:result.data.user_id,displayName:result.data.display_name,username:result.data.username}};
}
export async function usernameAvailability(req:Request,value:string){
 if(usernameError(value))return {available:false};
 const url=process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_KEY;
 if(!url||!key)throw new WorkspaceError(503,'Username checks are unavailable.');
 // Never store an IP address. A global cap also applies, independent of this client bucket.
 const hash=createHash('sha256').update(key).update(req.headers.get('x-vercel-forwarded-for')??req.headers.get('x-forwarded-for')?.split(',')[0]??'local').digest('hex').slice(0,32);
 const actor=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(12000)})}});
 const result=await db.rpc('chair_username_available',{p_username:normalizeUsername(value),p_actor:actor});identityError(result.error);
 return {available:result.data===true};
}
export async function notificationsRequest(req:Request){
 const {db}=await authenticate(req);
 if(req.method==='POST'){
  const body=await readBody(req);
  if(!Array.isArray(body.notificationIds)||body.notificationIds.length>100||body.notificationIds.some(id=>typeof id!=='string'))throw new WorkspaceError(400,'Choose up to 100 notifications.');
  const result=await db.rpc('chair_notifications_read',{p_ids:body.notificationIds.map(id=>validId(id))});identityError(result.error);return result.data;
 }
 const result=await db.rpc('chair_notifications');identityError(result.error);return result.data;
}
export async function respondInvitation(req:Request,id:string){
 const {db}=await authenticate(req),body=await readBody(req);
 if(body.action!=='accept'&&body.action!=='decline')throw new WorkspaceError(400,'Choose Accept or Decline.');
 const result=await db.rpc('chair_respond_invitation',{p_invitation:validId(id),p_action:body.action});identityError(result.error);return result.data;
}
