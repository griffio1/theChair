"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { ChatImage } from "../lib/workspace-types";
import "./chat-images.css";

async function auth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in to view or upload images.");
  return { authorization: `Bearer ${data.session.access_token}` };
}
function PrivateImage({ workspaceId, image }: { workspaceId: string; image: ChatImage }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true, objectUrl = "", started = false;
    const controller = new AbortController();
    setUrl(""); setError("");
    async function load() {
      if (started) return;
      started = true;
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/images/${image.id}`, {
          headers: await auth(), cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        });
        if (!response.ok) throw new Error("Image unavailable. Check your connection and workspace access.");
        const blob = await response.blob();
        if (!active) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Image unavailable."); }
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { observer.disconnect(); void load(); }
    }, { rootMargin: "200px" });
    if (container.current) observer.observe(container.current);
    return () => { active = false; controller.abort(); observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [workspaceId, image.id, attempt]);
  return <div className="chat-image" ref={container}>
    {url ? <button type="button" className="chat-image-open" onClick={() => dialog.current?.showModal()} aria-label={`Enlarge ${image.name}`}>
      <img src={url} alt={image.name} width={image.width} height={image.height} loading="lazy" />
    </button> : error ? <button type="button" className="chat-image-retry" onClick={() => setAttempt(n => n + 1)}>{error} Retry</button>
      : <span className="chat-image-loading" role="status">Loading image…</span>}
    <span className="chat-image-name" title={image.name}>{image.name}</span>
    <dialog className="chat-image-dialog" ref={dialog} onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <button type="button" onClick={() => dialog.current?.close()} autoFocus>Close image ×</button>
      {url && <img src={url} alt={image.name} />}
    </dialog>
  </div>;
}
export function ChatImages({ workspaceId, images }: { workspaceId: string; images?: ChatImage[] }) {
  if (!images?.length) return null;
  return <div className="chat-images">{images.map(image => <PrivateImage key={image.id} workspaceId={workspaceId} image={image} />)}</div>;
}

export function ImagePicker({ workspaceId, images, onChange, disabled, onBusy }: {
  workspaceId: string; images: ChatImage[]; onChange: (images: ChatImage[]) => void;
  disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLElement>(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  const chooseLatest = useRef<(files: File[]) => Promise<void>>(async () => {});
  const controller = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [previews, setPreviews] = useState<{name:string;url:string}[]>([]);
  const previewUrls = useRef<string[]>([]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); previewUrls.current.forEach(URL.revokeObjectURL); };
  }, []);
  useEffect(() => {
    // Listen on the whole composer so dropping/pasting into its textarea works too.
    const composer = picker.current?.closest("form");
    if (!composer) return;
    let depth = 0;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const reset = () => { depth = 0; composer.classList.remove("chat-image-drop-active"); };
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); depth++;
      composer.classList.add("chat-image-drop-active");
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = () => { if (--depth <= 0) reset(); };
    const drop = (event: DragEvent) => {
      reset();
      if (!hasFiles(event)) return;
      event.preventDefault();
      void chooseLatest.current(Array.from(event.dataTransfer?.files ?? []));
    };
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter(item => item.kind === "file" && item.type.startsWith("image/"))
        .map(item => item.getAsFile()).filter((file): file is File => file !== null);
      if (!files.length) return; // Leave ordinary text paste unchanged.
      event.preventDefault();
      void chooseLatest.current(files);
    };
    composer.addEventListener("dragenter", enter);
    composer.addEventListener("dragover", over);
    composer.addEventListener("dragleave", leave);
    composer.addEventListener("drop", drop);
    composer.addEventListener("paste", paste);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    return () => {
      reset();
      composer.removeEventListener("dragenter", enter);
      composer.removeEventListener("dragover", over);
      composer.removeEventListener("dragleave", leave);
      composer.removeEventListener("drop", drop);
      composer.removeEventListener("paste", paste);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
    };
  }, []);
  async function choose(files: File[]) {
    if (!files.length) return;
    if (inFlight.current || disabled) { setError("Wait for the current upload or message to finish, then try again."); return; }
    setError("");
    if (files.length + images.length > 4) { setError("Attach up to four images per message."); return; }
    if (files.some(f => !["image/png","image/jpeg","image/webp"].includes(f.type) || !f.size || f.size > 3 * 1024 * 1024)) {
      setError("Choose PNG, JPEG or WebP files up to 3 MiB each."); return;
    }
    const abort = new AbortController(); controller.current = abort;
    inFlight.current = true;
    setUploading(true); onBusy(true);
    const pending = files.map(file => ({name:file.name,url:URL.createObjectURL(file)}));
    previewUrls.current = pending.map(p => p.url); setPreviews(pending);
    const uploaded = [...images];
    try {
      for (const file of files) {
        const data = new FormData(); data.set("file",file); data.set("clientUploadId",crypto.randomUUID());
        const response = await fetch(`/api/workspaces/${workspaceId}/images`, {
          method:"POST", headers:await auth(), body:data, signal:AbortSignal.any([abort.signal,AbortSignal.timeout(45000)]),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Upload failed. Please select the image again.");
        if (!active.current) return;
        uploaded.push(result.image); onChange([...uploaded]);
      }
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : "Image upload failed."); }
    finally {
      inFlight.current = false;
      pending.forEach(p => URL.revokeObjectURL(p.url)); previewUrls.current = [];
      if (active.current) { setPreviews([]); setUploading(false); onBusy(false); }
    }
  }
  chooseLatest.current = choose;
  return <section ref={picker} className="chat-image-picker" aria-label="Image attachments">
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={e => {
      void choose(Array.from(e.target.files ?? [])); e.target.value="";
    }} />
    <div className="chat-image-picker-bar">
      <button type="button" className="chat-image-add" disabled={disabled || uploading || images.length >= 4} onClick={() => input.current?.click()}>
        {uploading ? "Uploading…" : "+ Add images"}
      </button>
      <small>Drop images here or paste with Ctrl+V / ⌘V · up to 4, 3 MiB each</small>
    </div>
    {!!images.length && <div className="chat-image-drafts">{images.map(image => <div key={image.id}>
      <PrivateImage workspaceId={workspaceId} image={image} />
      <button type="button" disabled={disabled || uploading} onClick={() => onChange(images.filter(i => i.id !== image.id))} aria-label={`Remove ${image.name}`}>Remove ×</button>
    </div>)}</div>}
    {!!previews.length && <div className="chat-image-drafts" aria-label="Uploading images">{previews.map((p,i) => <div key={i}>
      <img className="chat-image-preview" src={p.url} alt={`Uploading ${p.name}`} />
    </div>)}</div>}
    {error && <p className="chat-image-error" role="alert">{error}</p>}
  </section>;
}
