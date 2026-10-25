"use client";

import {useEffect, useRef, useState, type FormEvent} from "react";
import {supabase} from "../lib/supabase";
import type {ProjectInfo as Project, Workspace} from "../lib/workspace-types";
import {formatProjectText, type TextFormat} from "../lib/project-editor";
import {LoadingSkeleton} from './loading-skeleton';
import {Markdown} from "./markdown";
import {ChatImages, ImagePicker} from "./chat-images";
import {HackathonCountdown} from "./hackathon-countdown";
import "./project-info.css";

const localDeadline=(value:string|null)=>value ? new Date(Date.parse(value)-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16) : "";

export default function ProjectInfo({workspace,userId,onSaved}:{workspace:Workspace;userId:string;onSaved:(project:Project)=>void}) {
  const [project,setProject]=useState<Project|null>(null);
  const [draft,setDraft]=useState<Project|null>(null);
  const [deadline,setDeadline]=useState("");
  const [editing,setEditing]=useState(false);
  const [preview,setPreview]=useState(false);
  const [busy,setBusy]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [error,setError]=useState("");
  const [conflict,setConflict]=useState(false);
  const [reload,setReload]=useState(0);
  const textarea=useRef<HTMLTextAreaElement>(null);
  const alive=useRef(false), saving=useRef(false);
  const controller=useRef<AbortController|null>(null);
  const owner=workspace.role==="owner";

  async function request(init?:RequestInit,signal?:AbortSignal):Promise<Project> {
    const {data}=await supabase.auth.getSession();
    if(data.session?.user.id!==userId)throw new Error("Sign in again to open this project.");
    const response=await fetch(`/api/workspaces/${workspace.id}/project`,{...init,cache:"no-store",
      headers:{"content-type":"application/json",authorization:`Bearer ${data.session.access_token}`},
      signal:AbortSignal.any([signal ?? new AbortController().signal,AbortSignal.timeout(20000)])});
    const result=await response.json();
    if(!response.ok){if(response.status===409 && alive.current)setConflict(true);throw new Error(result.error || "Couldn't save project info.");}
    return result.project;
  }
  useEffect(()=>{
    alive.current=true;
    const ctrl=new AbortController();controller.current=ctrl;
    setError("");setConflict(false);setProject(null);setDraft(null);setEditing(false);
    void request(undefined,ctrl.signal).then(result=>{
      if(!ctrl.signal.aborted){setProject(result);setDraft(result);setDeadline(localDeadline(result.deadline));}
    }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:"Couldn't load project info.");});
    return ()=>{alive.current=false;ctrl.abort();};
  },[workspace.id,userId,reload]);

  function format(kind:TextFormat) {
    if(!draft || !textarea.current)return;
    const result=formatProjectText(draft.description,textarea.current.selectionStart,textarea.current.selectionEnd,kind);
    if(result.text.length>10000){setError("Keep the description under 10,000 characters.");return;}
    setDraft({...draft,description:result.text});
    requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(result.start,result.end);});
  }
  async function save(event:FormEvent) {
    event.preventDefault();
    if(!draft || saving.current || uploading)return;
    const end=draft.hackathonMode && deadline ? new Date(deadline) : null;
    if(draft.hackathonMode && (!end || !Number.isFinite(end.getTime()))){setError("Choose a deadline.");return;}
    saving.current=true;setBusy(true);setError("");setConflict(false);
    try {
      const result=await request({method:"POST",body:JSON.stringify({name:draft.name,description:draft.description,
        hackathonMode:draft.hackathonMode,...(end?{deadline:end.toISOString()}:{}),
        imageIds:draft.images.map(image=>image.id),revision:draft.revision})},controller.current?.signal);
      if(!alive.current)return;
      setProject(result);setDraft(result);setDeadline(localDeadline(result.deadline));setEditing(false);onSaved(result);
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:"Couldn't save project info.");}
    finally{saving.current=false;if(alive.current)setBusy(false);}
  }
  function cancel() {setDraft(project);setDeadline(localDeadline(project?.deadline ?? null));setEditing(false);setPreview(false);setError("");setConflict(false);}

  return <div className="project-info">
    <section className="wp-page-heading project-heading"><div><span className="project-eyebrow">Project info</span><h1>{project?.name ?? workspace.name}</h1></div>
      {owner && project && !editing && <button className="wp-secondary" onClick={()=>{setEditing(true);setPreview(false);}}>Edit project</button>}
    </section>
    {error && <div className="project-error" role="alert">{error}
      {(!project || conflict) && <button className="wp-secondary" disabled={busy} onClick={()=>setReload(n=>n+1)}>{conflict?"Discard edits and reload":"Try again"}</button>}
    </div>}
    {!project && !error && <LoadingSkeleton label="Loading project" cards={2} />}
    {project && !editing && <>
      {project.hackathonMode && project.deadline && <HackathonCountdown deadline={project.deadline} />}
      <section className="project-card project-description" aria-label="Project description">
        {project.description ? <Markdown text={project.description} preserveEmoji /> : <p className="project-empty">No description yet.</p>}
        <ChatImages workspaceId={workspace.id} images={project.images} project />
      </section>
    </>}
    {editing && draft && owner && <form onSubmit={save} className="project-card project-form">
      <label className="wp-field">Project name<input required maxLength={80} value={draft.name} disabled={busy} onChange={e=>setDraft({...draft,name:e.target.value})} /></label>
      <div className="project-description-label"><label htmlFor="project-description">Description</label><button type="button" className="wp-text-button" aria-pressed={preview} onClick={()=>setPreview(!preview)}>{preview?"Write":"Preview"}</button></div>
      {!preview ? <>
        <div className="project-toolbar" role="group" aria-label="Text formatting">
          {([['bold','Bold'],['italic','Italic'],['heading','Heading'],['bullets','Bullets'],['numbers','Numbered list'],['link','Link']] as const).map(([kind,label])=>
            <button key={kind} type="button" disabled={busy} onClick={()=>format(kind)}>{label}</button>)}
        </div>
        <textarea id="project-description" ref={textarea} maxLength={10000} rows={12} value={draft.description} disabled={busy}
          placeholder="What are you building?" onChange={e=>setDraft({...draft,description:e.target.value})} />
        <p className="project-help">Markdown supported.</p>
      </> : <div className="project-preview"><Markdown text={draft.description || "Nothing to preview yet."} preserveEmoji /></div>}
      <ImagePicker workspaceId={workspace.id} images={draft.images} project onChange={images=>setDraft(previous=>previous?{...previous,images}:previous)} disabled={busy} onBusy={setUploading} />
      <fieldset className="project-hackathon"><legend>Hackathon</legend>
        <label className="project-toggle"><input type="checkbox" checked={draft.hackathonMode} disabled={busy} onChange={e=>setDraft({...draft,hackathonMode:e.target.checked})} />Show a countdown</label>
        {draft.hackathonMode && <label className="wp-field">Deadline<input type="datetime-local" required value={deadline} disabled={busy} onChange={e=>setDeadline(e.target.value)} /><span className="project-help">Your local time. Everyone sees the same deadline.</span></label>}
      </fieldset>
      <div className="project-form-actions"><button type="submit" className="wp-primary" disabled={busy || uploading || conflict}>{busy?"Saving…":"Save changes"}</button><button type="button" className="wp-secondary" disabled={busy || uploading} onClick={cancel}>Cancel</button></div>
    </form>}
  </div>;
}
