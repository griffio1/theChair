"use client";
import {useEffect,useRef,useState} from 'react';
import {identityRequest} from '../lib/identity-client';
import type {InviteNotification} from '../lib/usernames';
import './notification-inbox.css';

export default function NotificationInbox({userId,onAccepted}:{userId:string;onAccepted:(id:string)=>void}) {
 const [open,setOpen]=useState(false),[items,setItems]=useState<InviteNotification[]>([]),[count,setCount]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[loaded,setLoaded]=useState(false);
 const root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),pending=useRef(false),sequence=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const ctrl=new AbortController();
  async function load(){
   if(document.hidden||pending.current)return;
   const seq=++sequence.current;
   try {
    const result=await identityRequest<{notifications:InviteNotification[];unreadCount:number}>('/api/notifications',userId,undefined,ctrl.signal);
    if(ctrl.signal.aborted||seq!==sequence.current)return;
    setItems(result.notifications);setCount(result.unreadCount);setError('');setLoaded(true);
    const ids=result.notifications.filter(i=>!i.seen).map(i=>i.id);
    if(open&&ids.length){
     const read=await identityRequest<{unreadCount:number}>('/api/notifications/read',userId,{notificationIds:ids},ctrl.signal);
     if(!ctrl.signal.aborted&&seq===sequence.current)setCount(read.unreadCount);
    }
   }catch{if(!ctrl.signal.aborted)setError('Could not load invites.');}
  }
  void load();const timer=setInterval(()=>void load(),30000);
  const focus=()=>void load();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
  return ()=>{ctrl.abort();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[userId,open,refresh]);
 useEffect(()=>{
  if(!open)return;
  const click=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};
  document.addEventListener('pointerdown',click);document.addEventListener('keydown',key);
  return ()=>{document.removeEventListener('pointerdown',click);document.removeEventListener('keydown',key);};
 },[open]);
 async function respond(id:string,action:'accept'|'decline'){
  if(pending.current)return;pending.current=true;++sequence.current;setBusy(true);setActionError('');
  try{
   const result=await identityRequest<{workspaceId?:string}>(`/api/invitations/${id}/respond`,userId,{action});
   if(!alive.current)return;
   if(result.workspaceId&&action==='accept'){setOpen(false);onAccepted(result.workspaceId);}
  }catch(e){if(alive.current)setActionError(e instanceof Error?e.message:'Could not respond.');}
  finally{pending.current=false;setBusy(false);setRefresh(n=>n+1);}
 }
 return <div className="invite-inbox" ref={root}>
  <button ref={button} className="wp-secondary invite-bell" aria-label={`Invites${count?`, ${count} unread`:''}`} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>{count>0&&<span className="invite-count">{count>99?'99+':count}</span>}
  </button>
  {open&&<section className="invite-popover" aria-label="Invites"><header><strong>Invites</strong><button className="wp-text-button" onClick={()=>setOpen(false)} aria-label="Close invites">×</button></header>
   {error&&<p role="alert">{error} <button onClick={()=>setRefresh(n=>n+1)}>Retry</button></p>}
   {actionError&&<p role="alert">{actionError}</p>}
   {!loaded&&!error&&<p>Loading?</p>}
   {loaded&&!items.length&&!error&&<p>No invites</p>}
   {items.map(i=><article key={i.id}><strong>{i.workspaceName}</strong><p>{i.inviterUsername?`@${i.inviterUsername}`:i.inviterName} invited you</p>{i.status==='pending'?<div><button className="wp-primary" disabled={busy} onClick={()=>void respond(i.id,'accept')}>Accept</button><button className="wp-secondary" disabled={busy} onClick={()=>void respond(i.id,'decline')}>Decline</button></div>:<small>{i.status}</small>}</article>)}
  </section>}
 </div>;
}
