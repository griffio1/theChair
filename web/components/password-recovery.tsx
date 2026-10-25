"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { initialRecoveryState, recoveryAuthEvent, recoveryLink, recoveryPasswordError, recoveryRequestError, RECOVERY_LINK_ERROR, RECOVERY_REQUEST_ERROR, type RecoveryState, type RecoveryUser } from "../lib/password-recovery-state";
import { AppearancePicker } from "./appearance-picker";
import { BrandMark } from "./flow-art";
import { Captcha, captchaSiteKey } from "./captcha";
import { captchaSubmissionError, type CaptchaProof } from "../lib/captcha-policy";
import "./password-recovery.css";

export default function PasswordRecovery() {
  const [state,setState] = useState<RecoveryState>({mode:"loading",user:null,error:""});
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [confirmation,setConfirmation] = useState("");
  const [busy,setBusy] = useState(false);
  const [captcha,setCaptcha] = useState<CaptchaProof>(null);
  const [captchaReset,setCaptchaReset] = useState(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const currentUser = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let ready = false;
    let latestUser: RecoveryUser | null | undefined;
    let rejectedLink = false;
    const link = recoveryLink(location.search,location.hash);
    rejectedLink = link === "invalid";
    const {data:listener} = supabase.auth.onAuthStateChange((event,session) => {
      if (!active || event === "INITIAL_SESSION") return;
      const user: RecoveryUser | null = session ? {id:session.user.id,email:session.user.email} : null;
      // Initialization can emit auth events before its callback validation has settled.
      // Save the latest identity without exposing a password form until validation finishes.
      if (!ready) { latestUser = user; return; }
      if (rejectedLink) return;
      if (currentUser.current !== (user?.id ?? null)) { setPassword(""); setConfirmation(""); }
      currentUser.current = user?.id ?? null;
      // Keep the callback synchronous: auth methods here can deadlock SDK initialization.
      setState(previous => recoveryAuthEvent(previous,event,user));
    });
    void (async () => {
      try {
        const initialization = await supabase.auth.initialize();
        rejectedLink ||= !!initialization.error;
        const {data,error} = await supabase.auth.getSession();
        if (!active) return;
        rejectedLink ||= !!error;
        const sessionUser = data.session ? {id:data.session.user.id,email:data.session.user.email} : null;
        const initial = initialRecoveryState(link,latestUser === undefined ? sessionUser : latestUser,rejectedLink);
        currentUser.current = initial.user?.id ?? null;
        setState(initial);
        ready = true;
      } catch {
        if (active) { rejectedLink = true; ready = true; currentUser.current = null; setState(initialRecoveryState("invalid",null)); }
      } finally {
        // Only scrub the callback URL after the SDK has finished exchanging it.
        if (active) history.replaceState(history.state,"",location.pathname);
      }
    })();
    return () => { active = false; mounted.current = false; listener.subscription.unsubscribe(); };
  },[]);

  useEffect(() => { if (state.mode !== "loading") heading.current?.focus(); },[state.mode]);

  async function requestLink(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const verification = captchaSubmissionError("recovery",captchaSiteKey,captcha);
    if (verification) { setState(previous => ({...previous,error:verification})); return; }
    pending.current = true; setBusy(true); setState(previous => ({...previous,error:""}));
    try {
      // Keep account outcomes neutral; delivery outages need a retry, not a sent notice.
      const result = await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:`${location.origin}/recover`,captchaToken:captcha?.token});
      const requestError = recoveryRequestError(result.error);
      if (requestError) {
        if (mounted.current) setState(previous => ({...previous,error:requestError}));
        return;
      }
      if (mounted.current) setState({mode:"sent",user:null,error:""});
    } catch {
      if (mounted.current) setState(previous => ({...previous,error:RECOVERY_REQUEST_ERROR}));
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(false); setCaptcha(null); setCaptchaReset(value => value + 1); }
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !state.user) return;
    const validation = recoveryPasswordError(password,confirmation);
    if (validation) { setState(previous => ({...previous,error:validation})); return; }
    const actor = state.user.id;
    pending.current = true; setBusy(true); setState(previous => ({...previous,error:""}));
    try {
      const session = await supabase.auth.getSession();
      if (session.error || session.data.session?.user.id !== actor || currentUser.current !== actor) {
        if (mounted.current) setState(initialRecoveryState("invalid",null));
        return;
      }
      const result = await supabase.auth.updateUser({password});
      if (!mounted.current || currentUser.current !== actor) return;
      if (result.error) {
        if ([401,403].includes(result.error.status ?? 0) || result.error.code === "reauthentication_needed") {
          setState({mode:"request",user:null,error:RECOVERY_LINK_ERROR});
        } else {
          const message = result.error.code === "same_password" ? "Choose a different password."
            : result.error.code === "weak_password" ? "Use a stronger password."
            : "Couldn’t change your password. Try again or request a new link.";
          setState(previous => ({...previous,error:message}));
        }
        return;
      }
      setPassword(""); setConfirmation("");
      setState(previous => ({...previous,mode:"complete",error:""}));
    } catch {
      if (mounted.current && currentUser.current === actor)
        setState(previous => ({...previous,error:"Couldn’t confirm the change. Try signing in, or request a new link."}));
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }

  function showRequest() {
    setPassword(""); setConfirmation("");
    setState({mode:"request",user:null,error:""});
  }

  return <div className="password-recovery">
    <header className="recovery-header">
      <a href="/" className="recovery-brand" aria-label="theChair home"><BrandMark size={26} />theChair<span>.</span></a>
      <AppearancePicker />
    </header>
    <main className="recovery-card" aria-busy={busy || state.mode === "loading"}>
      <h1 ref={heading} tabIndex={-1}>{state.mode === "update" ? "New password" : state.mode === "complete" ? "Password changed" : state.mode === "sent" ? "Check your email" : "Reset password"}</h1>
      {state.error && <p className="recovery-error" role="alert">{state.error}</p>}
      {state.mode === "loading" ? <p role="status">Checking your link…</p>
        : state.mode === "sent" ? <>
          <p role="status">If an account uses that email, you’ll receive a reset link. Check your spam folder too.</p>
          <button className="recovery-text" type="button" onClick={showRequest}>Try another email</button>
        </> : state.mode === "complete" ? <>
          <p role="status">Your new password is saved.</p>
          <a className="recovery-primary" href="/workspaces">Open workspace</a>
        </> : state.mode === "update" ? <>
          {state.user?.email && <p className="recovery-account">For {state.user.email}</p>}
          <form onSubmit={changePassword}>
            <label>New password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} aria-describedby="recovery-password-help" /></label>
            <p id="recovery-password-help" className="recovery-help">At least 8 characters.</p>
            <label>Confirm password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
            <button className="recovery-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save password"}</button>
          </form>
          <button className="recovery-text" disabled={busy} type="button" onClick={showRequest}>Request a new link</button>
        </> : <>
          <p>Enter your account email.</p>
          <form onSubmit={requestLink}>
            <label>Email<input type="email" autoComplete="email" maxLength={254} required disabled={busy} value={email} onChange={event => setEmail(event.target.value)} /></label>
            <Captcha action="recovery" resetKey={captchaReset} onToken={setCaptcha} disabled={busy} />
            <button className="recovery-primary" disabled={busy} type="submit">{busy ? "Sending…" : "Send reset link"}</button>
          </form>
        </>}
      {state.mode !== "complete" && <a className="recovery-back" href="/workspaces">Back to sign in</a>}
    </main>
  </div>;
}
