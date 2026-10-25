"use client";

import {useEffect,useRef,useState,type FormEvent} from "react";
import type {User} from "@supabase/supabase-js";
import {supabase} from "../lib/supabase";
import {accountError,accountName,profileError,profileFields} from "../lib/account-settings";
import {recoveryPasswordError} from "../lib/password-recovery-state";
import "./account-settings.css";
import {identityRequest} from '../lib/identity-client';
import {normalizeUsername,type AccountProfile} from '../lib/usernames';

type Section="profile"|"email"|"password";
type Feedback={section:Section;error?:string;message?:string};

export default function AccountSettings({user,onSaved}:{user:User;onSaved:()=>void}) {
  const initial=profileFields(user.user_metadata,user.email);
  const [displayName,setDisplayName]=useState(initial.displayName);
  const [username,setUsername]=useState("");
  const [profileReady,setProfileReady]=useState(false);
  const [profileAttempt,setProfileAttempt]=useState(0);
  const [email,setEmail]=useState(user.new_email || user.email || "");
  const [currentPassword,setCurrentPassword]=useState("");
  const [password,setPassword]=useState("");
  const [confirmation,setConfirmation]=useState("");
  const [nonce,setNonce]=useState("");
  const [needsCode,setNeedsCode]=useState(false);
  const [busy,setBusy]=useState<Section|null>(null);
  const [feedback,setFeedback]=useState<Feedback|null>(null);
  const mounted=useRef(false), pending=useRef(false), actor=useRef(user.id);
  const userId=user.id;

  useEffect(()=>{
    const ctrl=new AbortController();setProfileReady(false);
    void identityRequest<{profile:AccountProfile}>('/api/account/profile',userId,undefined,ctrl.signal).then(({profile})=>{
      if(ctrl.signal.aborted)return;
      setDisplayName(profile.displayName);setUsername(profile.username??'');setProfileReady(true);
    }).catch(()=>{if(!ctrl.signal.aborted)setFeedback({section:'profile',error:'Could not load your profile. Try again.'});});
    return ()=>ctrl.abort();
  },[userId,profileAttempt]);

  useEffect(()=>{
    mounted.current=true;
    const {data}=supabase.auth.onAuthStateChange((_event,session)=>{
      actor.current=session?.user.id ?? "";
      if(actor.current!==userId) {setCurrentPassword("");setPassword("");setConfirmation("");setNonce("");}
    });
    return ()=>{mounted.current=false;data.subscription.unsubscribe();};
  },[userId]);

  async function perform(section:Section,action:()=>Promise<void>) {
    if(pending.current) return;
    pending.current=true;setBusy(section);setFeedback(null);
    try {
      const {data,error}=await supabase.auth.getSession();
      if(error || data.session?.user.id!==userId || actor.current!==userId) {
        if(mounted.current)setFeedback({section,error:"Sign in again to update your account."});
        return;
      }
      await action();
    } catch {
      if(mounted.current && actor.current===userId)setFeedback({section,error:"Couldn't confirm the change. Try again."});
    } finally {pending.current=false;if(mounted.current)setBusy(null);}
  }
  const stillHere=()=>mounted.current && actor.current===userId;
  function status(section:Section) {
    return feedback?.section===section ? <p className={feedback.error?"account-error":"account-success"} role={feedback.error?"alert":"status"}>{feedback.error || feedback.message}</p> : null;
  }
  function saveProfile(event:FormEvent) {
    event.preventDefault();
    if(!profileReady)return;
    const error=profileError(displayName,username);
    if(error){setFeedback({section:"profile",error});return;}
    void perform("profile",async()=>{
      try {
        const {profile}=await identityRequest<{profile:AccountProfile}>('/api/account/profile',userId,{displayName:displayName.trim(),username:normalizeUsername(username)});
        if(!stillHere())return;
        setUsername(profile.username??'');setDisplayName(profile.displayName);
        setFeedback({section:"profile",message:"Profile saved."});onSaved();
        await supabase.auth.refreshSession();
      }catch(error){if(stillHere())setFeedback({section:'profile',error:error instanceof Error?error.message:'Could not save profile.'});}
    });
  }
  function saveEmail(event:FormEvent) {
    event.preventDefault();
    const next=email.trim();
    if(next.toLowerCase()===user.email?.toLowerCase()){setFeedback({section:"email",message:"You're already using this email."});return;}
    void perform("email",async()=>{
      // Reuse the existing allowed /workspaces auth callback. No new redirect URL is required.
      const result=await supabase.auth.updateUser({email:next},{emailRedirectTo:`${location.origin}/workspaces`});
      if(!stillHere())return;
      if(result.error){setFeedback({section:"email",error:accountError(result.error)});return;}
      setFeedback({section:"email",message:result.data.user?.email?.toLowerCase()===next.toLowerCase()?"Email updated.":"Check your email to confirm the change."});
    });
  }
  function savePassword(event:FormEvent) {
    event.preventDefault();
    const error=recoveryPasswordError(password,confirmation) || (needsCode && !nonce.trim()?"Enter the code from your email.":"");
    if(error){setFeedback({section:"password",error});return;}
    void perform("password",async()=>{
      const result=await supabase.auth.updateUser({password,current_password:currentPassword,...(needsCode?{nonce:nonce.trim()}:{})});
      if(!stillHere())return;
      if(result.error){
        if(result.error.code==="reauthentication_needed" || result.error.code==="reauthentication_not_valid")setNeedsCode(true);
        setFeedback({section:"password",error:accountError(result.error)});return;
      }
      setCurrentPassword("");setPassword("");setConfirmation("");setNonce("");setNeedsCode(false);
      setFeedback({section:"password",message:"Password updated."});
    });
  }
  function sendCode() {
    void perform("password",async()=>{
      const result=await supabase.auth.reauthenticate();
      if(!stillHere())return;
      setFeedback(result.error?{section:"password",error:accountError(result.error)}:{section:"password",message:"Check your email for the verification code."});
    });
  }

  return <div className="account-settings">
    <section className="wp-page-heading"><h1>Account</h1></section>
    <section className="account-card" aria-labelledby="profile-heading">
      <div className="account-card-heading"><span className="wp-avatar" aria-hidden="true">{accountName({displayName},user.email).charAt(0).toUpperCase()}</span><div><h2 id="profile-heading">Profile</h2><p>Choose how your team sees you.</p></div></div>
      <form onSubmit={saveProfile}>
        <div className="account-fields">
          <label className="wp-field">Display name<input autoComplete="name" required maxLength={80} value={displayName} disabled={!!busy||!profileReady} onChange={event=>setDisplayName(event.target.value)} /></label>
          <label className="wp-field">Username<input autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={31} value={username} placeholder="@carterdestreel" disabled={!!busy||!profileReady} onChange={event=>setUsername(event.target.value)} aria-describedby="username-help" /></label>
        </div>
        <p id="username-help" className="account-help">People invite you using @{normalizeUsername(username)||'yourusername'}. Use 3–30 letters, numbers, or underscores.</p>
        {status("profile")}<button className="wp-primary" disabled={!!busy||!profileReady} type="submit">{busy==="profile"?"Saving…":"Save profile"}</button>
        {!profileReady && <button type="button" className="wp-text-button" onClick={()=>setProfileAttempt(n=>n+1)}>Reload profile</button>}
      </form>
    </section>
    <section className="account-card" aria-labelledby="email-heading">
      <h2 id="email-heading">Email</h2><p className="account-help">{user.email}</p>
      {user.new_email && <p className="account-help">Awaiting confirmation: {user.new_email}</p>}
      <form onSubmit={saveEmail}>
        <label className="wp-field">New email<input type="email" autoComplete="email" required maxLength={254} value={email} disabled={!!busy} onChange={event=>setEmail(event.target.value)} /></label>
        <p className="account-help">Follow the confirmation links sent to your inboxes.</p>
        {status("email")}<button className="wp-secondary" disabled={!!busy} type="submit">{busy==="email"?"Saving…":"Change email"}</button>
      </form>
    </section>
    <section className="account-card" aria-labelledby="password-heading">
      <h2 id="password-heading">Password</h2>
      <form onSubmit={savePassword}>
        <label className="wp-field">Current password<input type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} disabled={!!busy} onChange={event=>setCurrentPassword(event.target.value)} /></label>
        <div className="account-fields">
          <label className="wp-field">New password<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} disabled={!!busy} onChange={event=>setPassword(event.target.value)} /></label>
          <label className="wp-field">Confirm new password<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} disabled={!!busy} onChange={event=>setConfirmation(event.target.value)} /></label>
        </div>
        <p className="account-help">At least 8 characters.</p>
        {needsCode && <div className="account-verification"><button type="button" className="wp-secondary" disabled={!!busy} onClick={sendCode}>Send verification code</button><label className="wp-field">Verification code<input inputMode="numeric" autoComplete="one-time-code" maxLength={20} value={nonce} disabled={!!busy} onChange={event=>setNonce(event.target.value)} /></label></div>}
        {status("password")}<div className="account-actions"><button className="wp-secondary" disabled={!!busy} type="submit">{busy==="password"?"Saving…":"Change password"}</button><a className="wp-text-button" href="/recover">Forgot password?</a></div>
      </form>
    </section>
  </div>;
}
