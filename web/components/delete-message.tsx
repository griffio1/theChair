"use client";
import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
export function DeleteMessage({workspaceId,conversationId,messageId,userId,onDeleted}:{workspaceId:string;conversationId:string;messageId:string;userId:string;onDeleted:()=>void}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false),ctrl=useRef<AbortController|null>(null);
 useEffect(()=>()=>ctrl.current?.abort(),[]);
 async function remove(){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  const abort=new AbortController();ctrl.current=abort;
  try{
   const {data}=await supabase.auth.getSession();
   if(data.session?.user.id!==userId)throw new Error('Sign in again.');
   const response=await fetch(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}`,{method:'DELETE',headers:{authorization:`Bearer ${data.session.access_token}`},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])});
   const result=await response.json();if(!response.ok||!result.deleted)throw new Error(result.error||'Could not delete. Try again.');
   if(!abort.signal.aborted)onDeleted();
  }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Could not delete.');}
  finally{pending.current=false;if(!abort.signal.aborted)setBusy(false);}
 }
 return <div className="message-delete">{confirm?<div role="group" aria-label="Confirm deletion"><span>Delete this message?</span> <button type="button" className="wp-text-button" disabled={busy} onClick={()=>void remove()}>{busy?'Deleting…':'Delete'}</button> <button type="button" className="wp-text-button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button></div>:<button type="button" className="wp-text-button" onClick={()=>setConfirm(true)}>Delete</button>}{error&&<p role="alert">{error}</p>}</div>;
}
