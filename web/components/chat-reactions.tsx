"use client";
import { useEffect, useId, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import "./chat-reactions.css";

type Reaction = { messageId: string; emoji: string; count: number; reactedByMe: boolean; people: { userId: string; displayName: string }[] };
const choices = [["👍","Like"],["❤️","Love"],["😂","Laugh"],["😮","Surprised"],["😢","Sad"],["🎉","Celebrate"]] as const;
async function request(path: string, signal: AbortSignal, body?: object): Promise<Reaction[]> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in to react.");
  const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", signal,
    headers: { authorization: `Bearer ${data.session.access_token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Couldn't update your reaction. Try again.");
  return result.reactions;
}
export function useConversationReactions(workspaceId: string, conversationId: string, userId: string | undefined, enabled = true) {
  const scope = `${userId}/${workspaceId}/${conversationId}`;
  const [state, setState] = useState<{scope:string;rows:Reaction[]}>({scope:"",rows:[]});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const liveScope = useRef(scope); liveScope.current = scope;
  const mutation = useRef(0);
  const pending = useRef<{scope:string} | null>(null);
  const base = `/api/workspaces/${workspaceId}/conversations/${conversationId}`;
  useEffect(() => {
    setState({scope,rows:[]}); setError(""); setBusy("");
    pending.current = null;
    mutation.current++;
    if (!workspaceId || !conversationId || !userId || !enabled) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const version = mutation.current;
      try {
        const rows = await request(`${base}/reactions`, AbortSignal.any([ctrl.signal,AbortSignal.timeout(15000)]));
        if (!ctrl.signal.aborted && version === mutation.current && !pending.current) setState({scope,rows});
      } catch { /* Reactions never block the conversation; writes show actionable errors. */ }
      finally { if (!ctrl.signal.aborted) timer = setTimeout(load,5000); }
    }
    void load();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [scope, base, workspaceId, conversationId, userId, enabled]);
  async function toggle(messageId:string,emoji:string) {
    if (pending.current?.scope === scope) return;
    const operation = {scope};
    pending.current = operation; mutation.current++; setBusy(messageId); setError("");
    const rows = state.scope === scope ? state.rows : [];
    const active = !rows.find(r => r.messageId === messageId && r.emoji === emoji)?.reactedByMe;
    try {
      const updated = await request(`${base}/messages/${messageId}/reactions`, AbortSignal.timeout(15000), {emoji,active});
      if (liveScope.current === scope && pending.current === operation) setState(previous => ({scope,rows:[...(previous.scope === scope ? previous.rows : []).filter(r => r.messageId !== messageId),...updated]}));
    } catch (e) { if (liveScope.current === scope && pending.current === operation) setError(e instanceof Error ? e.message : "Couldn't update your reaction. Try again."); }
    finally {
      if (pending.current === operation) {
        pending.current = null; mutation.current++;
        if (liveScope.current === scope) setBusy("");
      }
    }
  }
  return { rows: state.scope === scope ? state.rows : [], busy, error, toggle };
}
export function MessageReactions({messageId,reactions}: {messageId:string;reactions:ReturnType<typeof useConversationReactions>}) {
  const [open,setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const pickerId = useId();
  const rows = reactions.rows.filter(r => r.messageId === messageId);
  useEffect(() => {
    if (!open) return;
    // The picker precedes its trigger in the DOM, so Tab alone cannot enter it
    // after opening. Move focus to the first available native button.
    picker.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const close = (event:PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown",close);
    return () => document.removeEventListener("pointerdown",close);
  },[open]);
  return <div className="message-reactions" ref={root} data-open={open || undefined} onKeyDown={event => {
    if (event.key === "Escape") {event.preventDefault();setOpen(false);button.current?.focus();}
  }} onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);}}>
    <div className="reaction-picker" ref={picker} id={pickerId} role="group" aria-label="Choose a reaction">
      {choices.map(([emoji,label]) => <button type="button" key={emoji} title={label} aria-label={label}
        aria-pressed={rows.some(r => r.emoji === emoji && r.reactedByMe)} disabled={!!reactions.busy}
        onClick={() => {void reactions.toggle(messageId,emoji);setOpen(false);button.current?.focus();}}><span>{emoji}</span></button>)}
    </div>
    <div className="reaction-counts">
      {rows.map(r => <button type="button" key={r.emoji} className="reaction-count" aria-pressed={r.reactedByMe}
        aria-label={`${r.emoji}, ${r.count} reaction${r.count === 1 ? "" : "s"}${r.reactedByMe ? ", including you" : ""}`}
        title={r.people.map(person => person.displayName).join(", ")} disabled={!!reactions.busy}
        onClick={() => void reactions.toggle(messageId,r.emoji)}>{r.emoji}<span>{r.count}</span></button>)}
      <button ref={button} type="button" className="reaction-trigger" aria-label="React to this message" aria-expanded={open} aria-controls={pickerId}
        onClick={() => setOpen(value => !value)}>☺<span>React</span></button>
      {reactions.busy === messageId && <span className="reaction-saving" role="status">Saving…</span>}
    </div>
  </div>;
}
