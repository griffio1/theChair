"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { AppearancePicker } from "../../components/appearance-picker";
import { ChatImages, ImagePicker } from "../../components/chat-images";
import { lastConversation, rememberConversation } from "../../lib/chat-selection";
import { MessageReactions, useConversationReactions } from "../../components/chat-reactions";
import { BrandMark, FlowArt } from "../../components/flow-art";
import { Captcha, captchaSiteKey } from "../../components/captcha";
import { captchaSubmissionError, CAPTCHA_UNAVAILABLE, type CaptchaProof } from "../../lib/captcha-policy";
import type {
  Workspace,
  WorkspaceChat,
  WorkspaceDetail,
  WorkspaceInvitation,
  WorkspaceMessage,
  ChatImage,
} from "../../lib/workspace-types";
import "./workspaces.css";

type View = "home" | "chat" | "people" | "contracts" | "conflicts";
type Draft = { body: string; clientMessageId: string; images?: ChatImage[] };
type Modal = "workspace" | "chat" | "invite" | "share";

type HubIconName = "home" | "people" | "contracts" | "conflicts" | "chat" | "plus" | "arrow" | "send" | "search" | "mail" | "close" | "spark";
function HubIcon({name,size = 18}: {name:HubIconName;size?:number}) {
  const paths: Record<HubIconName, React.ReactNode> = {
    home: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/></>,
    contracts: <><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
    conflicts: <><path d="m12 3 9 17H3L12 3Z"/><path d="M12 9v4m0 3v.1"/></>,
    chat: <><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M7 9h9m-9 4h6"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="M6 18 18 6M6 6h12v12"/>,
    send: <path d="M12 19V5m-6 6 6-6 6 6"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    spark: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const accessUnavailable = (error: unknown) =>
  error instanceof ApiError && [401, 403, 404].includes(error.status);

async function api<T>(
  path: string,
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in to continue.");
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      typeof result.error === "string"
        ? result.error
        : "Couldn’t finish. Try again.",
      response.status,
    );
  return result as T;
}
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Couldn’t finish. Try again.";

function AccountForm({ invited }: { invited: boolean }) {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaProof>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const pending = useRef(false);
  const signupUnavailable = signup && process.env.NODE_ENV === "production" && !captchaSiteKey;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    const verification = captchaSubmissionError(signup ? "signup" : "signin",captchaSiteKey,process.env.NODE_ENV === "production",captcha);
    if (verification) { setError(verification); return; }
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = signup
        ? await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              data: { displayName: name.trim() },
              emailRedirectTo: `${location.origin}/workspaces`,
              captchaToken: captcha?.token,
            },
          })
        : await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
            options: { captchaToken: captcha?.token },
          });
      if (result.error) throw result.error;
      setPassword("");
      if (signup && !result.data.session)
        setNotice(
          "Confirm your email, then sign in. Your invite stays in this tab.",
        );
    } catch (e) {
      setError(errorText(e));
    } finally {
      pending.current = false;
      setCaptcha(null);
      setCaptchaReset(value => value + 1);
      setBusy(false);
    }
  }
  return (
    <div className="wp-auth-layout">
      <div className="wp-auth-story" aria-hidden="true">
        <FlowArt className="wp-auth-art" />
      </div>
    <div className="wp-account-card">
      <span className="wp-account-symbol"><HubIcon name="spark" size={25} /></span>
      <h1>{signup ? "Create account" : "Sign in"}</h1>
      {invited && <p className="wp-dialog-copy">Use the email on your invite.</p>}
      <form onSubmit={submit}>
        {signup && (
          <label className="wp-field">
            Your name
            <input
              autoComplete="name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label className="wp-field">
          Email
          <input
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="wp-field">
          Password
          <input
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            required
            minLength={signup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {!signup && <a className="wp-text-button" href="/recover">Forgot password?</a>}
        <Captcha action={signup ? "signup" : "signin"} resetKey={captchaReset} onToken={setCaptcha} disabled={busy} />
        {signupUnavailable && <p className="wp-alert" role="status">{CAPTCHA_UNAVAILABLE}</p>}
        {error && (
          <p className="wp-alert" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="wp-notice" role="status">
            {notice}
          </p>
        )}
        <button className="wp-primary" disabled={busy || signupUnavailable} type="submit">
          {busy ? (signup ? "Creating…" : "Signing in…") : signup ? "Create account" : "Sign in"}<HubIcon name="arrow" size={16} />
        </button>
        <button
          className="wp-text-button wp-auth-switch"
          type="button"
          disabled={busy}
          onClick={() => {
            setSignup(!signup);
            setError("");
            setNotice("");
            setCaptcha(null);
            setCaptchaReset(value => value + 1);
          }}
        >
          {signup
            ? "Sign in instead"
            : "Create an account"}
        </button>
      </form>
    </div>
    </div>
  );
}

export default function Workspaces() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | undefined>();
  const [activeSpace, setActiveSpace] = useState("");
  const [activeChat, setActiveChat] = useState("");
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [teamWorkspace, setTeamWorkspace] = useState("");
  const [history, setHistory] = useState<{
    scope: string;
    items: WorkspaceMessage[];
  }>({ scope: "", items: [] });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [uploadScope, setUploadScope] = useState("");
  const [view, setView] = useState<View>("chat");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState<Modal | null>(null);
  const [field, setField] = useState("");
  const [formError, setFormError] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [syncState, setSyncState] = useState("Connecting");
  const dialog = useRef<HTMLDialogElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const userId = session?.user.id;
  const userRef = useRef(userId);
  userRef.current = userId;
  const accountReady = loadedFor === userId;
  const current =
    accountReady && detail?.workspace.id === activeSpace ? detail : null;
  const space = accountReady
    ? spaces.find((s) => s.id === activeSpace)
    : undefined;
  const chat = current?.chats.find((c) => c.id === activeChat);
  const scope = `${activeSpace}/${activeChat}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const visibleMessages = history.scope === scope ? history.items : [];
  const reactions = useConversationReactions(activeSpace, activeChat, userId, view === "chat" && visibleMessages.length > 0);
  const draft = drafts[scope]?.body ?? "";
  const draftImages = drafts[scope]?.images ?? [];
  const uploading = uploadScope === scope;
  useEffect(() => { setUploadScope(""); }, [scope, userId]);
  const me =
    session?.user.user_metadata?.displayName ||
    session?.user.email?.split("@")[0] ||
    "You";

  useEffect(() => {
    let active = true;
    // Invitation tokens live in the fragment, not request logs or referrers.
    const hash = new URLSearchParams(location.hash.slice(1));
    const token = hash.get("invite");
    try {
      if (token && /^[a-f0-9]{64}$/.test(token)) {
        sessionStorage.setItem("thechair:pending-invite", token);
        setInviteToken(token);
        window.history.replaceState(null, "", location.pathname);
      } else
        setInviteToken(sessionStorage.getItem("thechair:pending-invite") ?? "");
    } catch {
      if (token) setInviteToken(token);
    }
    let authEvent = false;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      authEvent = true;
      if (active) setSession(next);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active && !authEvent) {
        setSession(data.session);
        if (error) setError(error.message);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setLoadedFor(userId);
    setSpaces([]);
    setTeamWorkspace("");
    setDetail(null);
    const saved = userId ? lastConversation(userId) : null;
    setActiveSpace(saved?.workspaceId ?? "");
    setActiveChat(saved?.chatId ?? "");
    setHistory({ scope: "", items: [] });
    setDrafts({});
    setView("chat");
    setModal(null);
    setInviteUrl("");
    setField("");
    setFormError("");
    setError("");
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const ctrl = new AbortController();
    setLoading(true);
    void api<{ workspaces: Workspace[] }>(
      "/api/workspaces",
      undefined,
      ctrl.signal,
    )
      .then((result) => {
        if (ctrl.signal.aborted) return;
        setSpaces(result.workspaces);
        if (!result.workspaces.length) setView("home");
        setActiveSpace((id) =>
          result.workspaces.some((s) => s.id === id)
            ? id
            : (result.workspaces[0]?.id ?? ""),
        );
        setError("");
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [userId, refresh]);

  useEffect(() => {
    if (!activeSpace || !userId) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await api<WorkspaceDetail>(
          `/api/workspaces/${activeSpace}`,
          undefined,
          ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        setDetail(result);
        setTeamWorkspace(activeSpace);
        setActiveChat((id) =>
          result.chats.some((c) => c.id === id)
            ? id
            : (result.chats[0]?.id ?? ""),
        );
      } catch (e) {
        if (!ctrl.signal.aborted) {
          if (accessUnavailable(e)) {
            setDetail(null);
            setTeamWorkspace("");
            setActiveChat("");
            setHistory({scope:"",items:[]});
            setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(`${activeSpace}/`))));
            setSpaces(previous => previous.filter(workspace => workspace.id !== activeSpace));
          }
          setError(errorText(e));
        }
      } finally {
        if (!ctrl.signal.aborted) timer = setTimeout(load, 10000);
      }
    }
    void load();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [activeSpace, userId, refresh]);

  useEffect(() => {
    if (userId && current && chat) rememberConversation(userId, activeSpace, activeChat);
  }, [userId, current?.workspace.id, chat?.id, activeSpace, activeChat]);

  const mergeMessages = useCallback(
    (key: string, items: WorkspaceMessage[]) => {
      setHistory((previous) => {
        const byId = new Map(
          (previous.scope === key ? previous.items : []).map((m) => [m.id, m]),
        );
        for (const m of items) byId.set(m.id, m);
        return {
          scope: key,
          items: [...byId.values()]
            .sort(
              (a, b) =>
                a.createdAt.localeCompare(b.createdAt) ||
                a.id.localeCompare(b.id),
            )
            .slice(-200),
        };
      });
    },
    [],
  );

  useEffect(() => {
    if (!activeSpace || !activeChat || !userId) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setLoadingMessages(true);
    setSyncState("Connecting");
    async function load() {
      try {
        const result = await api<{ messages: WorkspaceMessage[] }>(
          `/api/workspaces/${activeSpace}/chats/${activeChat}/messages`,
          undefined,
          ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        mergeMessages(scope, result.messages);
        setSyncState("Synced");
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setSyncState("Retrying");
          if (accessUnavailable(e)) setHistory({scope:"",items:[]});
          setError(errorText(e));
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setLoadingMessages(false);
          timer = setTimeout(load, 5000);
        }
      }
    }
    void load();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [
    activeSpace,
    activeChat,
    userId,
    scope,
    mergeMessages,
    refresh,
  ]);

  useEffect(() => {
    if (view === "chat") bottom.current?.scrollIntoView({ block: "nearest" });
  }, [visibleMessages.length, scope, view]);
  useEffect(() => {
    if (!modal) return;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      trigger?.focus();
    };
  }, [modal]);

  function open(kind: Modal) {
    setField("");
    setFormError("");
    setNotice("");
    setModal(kind);
  }
  function chooseSpace(id: string) {
    setActiveSpace(id);
    setActiveChat("");
    setView("chat");
    setError("");
    setNotice("");
  }
  async function mutate(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const actor = userId;
    setBusy(true);
    setFormError("");
    try {
      if (modal === "workspace") {
        const result = await api<{ workspace: Workspace; chat: WorkspaceChat }>(
          "/api/workspaces",
          { name: field.trim() },
        );
        if (actor !== userRef.current) return;
        setSpaces((items) => [...items, result.workspace]);
        setActiveSpace(result.workspace.id);
        setActiveChat(result.chat.id);
        setView("chat");
        setNotice("Workspace created.");
        setModal(null);
      } else if (modal === "chat") {
        const result = await api<{ chat: WorkspaceChat }>(
          `/api/workspaces/${activeSpace}/chats`,
          { title: field.trim() },
        );
        if (actor !== userRef.current) return;
        setDetail((d) =>
          d?.workspace.id === activeSpace
            ? {
                ...d,
                chats: [
                  ...d.chats.filter((c) => c.id !== result.chat.id),
                  result.chat,
                ],
              }
            : d,
        );
        setActiveChat(result.chat.id);
        setView("chat");
        setModal(null);
      } else if (modal === "invite") {
        const result = await api<{ invitation: WorkspaceInvitation }>(
          `/api/workspaces/${activeSpace}/invitations`,
          { email: field.trim() },
        );
        if (actor !== userRef.current) return;
        if (!result.invitation.inviteUrl)
          throw new Error("Invite link missing. Try again.");
        setInviteUrl(
          new URL(result.invitation.inviteUrl, location.origin).href,
        );
        setModal("share");
        setView("people");
      }
      setRefresh((n) => n + 1);
    } catch (e) {
      if (actor === userRef.current) setFormError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    const item = drafts[scope];
    if (!item || (!item.body.trim() && !item.images?.length) || busy || uploading || !chat) return;
    const actor = userId;
    const key = scope;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ messages: WorkspaceMessage[] }>(
        `/api/workspaces/${activeSpace}/chats/${activeChat}/messages`,
        { body: item.body, clientMessageId: item.clientMessageId, imageIds: item.images?.map(image => image.id) ?? [] },
      );
      if (actor !== userRef.current) return;
      if (scopeRef.current === key) mergeMessages(key, result.messages);
      setDrafts((items) =>
        items[key]?.clientMessageId === item.clientMessageId
          ? {
              ...items,
              [key]: { body: "", clientMessageId: crypto.randomUUID() },
            }
          : items,
      );
      if (scopeRef.current === key) setSyncState("Synced");
    } catch (e) {
      if (actor === userRef.current && scopeRef.current === key)
        setError(
          `${errorText(e)} Your draft is still here. Retrying won’t send it twice.`,
        );
    } finally {
      setBusy(false);
    }
  }
  async function changeRole(memberId: string, role: "owner" | "member") {
    if (busy) return;
    setBusy(true);
    setError("");
    const actor = userId;
    try {
      await api(`/api/workspaces/${activeSpace}/members/${memberId}/role`, {
        role,
      });
      if (actor !== userRef.current) return;
      setRefresh((n) => n + 1);
      setNotice(`Role changed to ${role}.`);
    } catch (e) {
      if (actor === userRef.current) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function join() {
    if (!inviteToken || busy) return;
    setBusy(true);
    setError("");
    const actor = userId;
    try {
      const result = await api<{ workspaceId: string }>(
        "/api/invitations/accept",
        { token: inviteToken },
      );
      if (actor !== userRef.current) return;
      setInviteToken("");
      try {
        sessionStorage.removeItem("thechair:pending-invite");
      } catch {}
      chooseSpace(result.workspaceId);
      setRefresh((n) => n + 1);
      setNotice("Workspace joined.");
    } catch (e) {
      if (actor === userRef.current) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) setError(error.message);
    setBusy(false);
  }
  function updateDraft(body: string) {
    setDrafts((items) => ({
      ...items,
      [scope]: { ...items[scope], body, clientMessageId: crypto.randomUUID() },
    }));
  }

  const filtered = spaces.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className={`workspace-hub wp-live ${!session ? "wp-guest" : ""}`}>
      <aside className="wp-sidebar" aria-label="Workspace navigation">
        <a className="wp-brand" href="/workspaces">
          <span className="wp-brand-mark"><BrandMark size={25} /></span>theChair
          <span className="wp-dot">.</span>
        </a>
        {session && accountReady && (
          <>
            <label className="wp-space-picker">
              <span>WORKSPACE</span>
              <select
                aria-label="Switch workspace"
                value={activeSpace}
                disabled={busy || !spaces.length}
                onChange={(e) => chooseSpace(e.target.value)}
              >
                {!spaces.length && (
                  <option value="">No workspaces</option>
                )}
                {spaces.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <nav className="wp-nav" aria-label="Views">
              {(
                [
                  ["home", "home", "Workspaces"],
                  ["people", "people", "People"],
                  ["contracts", "contracts", "Agreements"],
                  ["conflicts", "conflicts", "Issues"],
                ] as const
              ).map(([key, icon, label]) => (
                <button
                  key={key}
                  className={view === key ? "active" : ""}
                  aria-current={view === key ? "page" : undefined}
                  disabled={busy || (key !== "home" && !activeSpace)}
                  onClick={() => setView(key)}
                >
                  <span className="wp-glyph" aria-hidden="true">
                    <HubIcon name={icon} />
                  </span>
                  {label}
                </button>
              ))}
              {activeSpace === teamWorkspace && teamWorkspace && (
                <a href={`/workspaces/${activeSpace}/team`}>
                  <span className="wp-glyph"><HubIcon name="spark" /></span>Team chat<HubIcon name="arrow" size={13} />
                </a>
              )}
            </nav>
            <div className="wp-section-label">
              <span>CHATS</span>
              <button
                className="wp-icon-button"
                disabled={busy || !current}
                onClick={() => open("chat")}
                aria-label="New chat"
              >
                <HubIcon name="plus" size={17} />
              </button>
            </div>
            <nav className="wp-threads" aria-label="Chats">
              {current?.chats.map((c) => (
                <button
                  key={c.id}
                  className={
                    view === "chat" && activeChat === c.id ? "active" : ""
                  }
                  disabled={busy}
                  aria-current={view === "chat" && activeChat === c.id ? "page" : undefined}
                  onClick={() => {
                    setActiveChat(c.id);
                    setView("chat");
                    setError("");
                  }}
                >
                  <span className="wp-glyph" aria-hidden="true">
                    <HubIcon name="chat" size={17} />
                  </span>
                  <span>{c.title}</span>
                </button>
              ))}
            </nav>
            <button
              className="wp-new-workspace"
              disabled={busy}
              onClick={() => open("workspace")}
            >
              <HubIcon name="plus" size={17} />New workspace
            </button>
          </>
        )}
        <div className="wp-sidebar-bottom">
          {session && (
            <>
              <div className="wp-profile">
                <span className="wp-avatar">
                  {String(me).slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{me}</strong>
                  <small>Signed in</small>
                </span>
              </div>
              <button
                className="wp-text-button"
                disabled={busy}
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </>
          )}
          {accountReady && activeSpace === teamWorkspace && teamWorkspace && (
            <a
              className="wp-legacy-link"
              href={`/workspaces/${activeSpace}/team`}
            >
              Team chat <HubIcon name="arrow" size={12} />
            </a>
          )}
        </div>
      </aside>
      <div className="wp-main">
        <header className="wp-topbar">
          <div className="wp-breadcrumb">
            <span>{space?.name ?? "theChair"}</span>
            <span className="wp-breadcrumb-divider" aria-hidden="true">/</span>
            <strong>
              {!session ? "Sign in" : view === "home"
                ? "Workspaces"
                : view === "chat"
                  ? (chat?.title ?? "Chat")
                  : view === "people"
                    ? "People"
                    : view === "contracts"
                      ? "Agreements"
                      : "Issues"}
            </strong>
          </div>
          <AppearancePicker />
          {session && (
            <button
              className="wp-mobile-signout wp-text-button"
              disabled={busy}
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          )}
        </header>
        <main className="wp-content">
          {error && (
            <div className="wp-alert" role="alert">
              {error}
              <div>
                <button
                  className="wp-text-button"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setRefresh((n) => n + 1);
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}
          <div className="wp-notice" role="status">
            {notice}
          </div>
          {session === undefined || (session && !accountReady) ? (
            <div className="wp-empty" role="status">
              Loading your account…
            </div>
          ) : !session ? (
            <AccountForm invited={!!inviteToken} />
          ) : (
            <>
              {inviteToken && (
                <div className="wp-join-banner">
                  <div>
                    <strong>Workspace invite</strong>
                    <p>
                      Use the verified email on the invite. You’re signed in as {session.user.email}.
                    </p>
                  </div>
                  <button
                    className="wp-primary"
                    disabled={busy}
                    onClick={() => void join()}
                  >
                    {busy ? "Joining…" : "Join workspace"}
                  </button>
                  <button
                    className="wp-text-button"
                    disabled={busy}
                    onClick={() => {
                      setInviteToken("");
                      try {
                        sessionStorage.removeItem("thechair:pending-invite");
                      } catch {}
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
              <div className="wp-view" key={view}>
              {view === "home" ? (
                <>
                  <section className="wp-page-heading wp-home-hero">
                    <div className="wp-home-copy">
                      <h1>Workspaces</h1>
                    </div>
                    <button
                      className="wp-primary"
                      disabled={busy}
                      onClick={() => open("workspace")}
                    >
                      <HubIcon name="plus" size={16} />New workspace
                    </button>
                    <FlowArt className="wp-home-art" />
                  </section>
                  <div className="wp-list-toolbar">
                    <label className="wp-search">
                      <HubIcon name="search" size={16} />
                      <input
                        type="search"
                        aria-label="Search workspaces"
                        placeholder="Search workspaces"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  {loading && !spaces.length ? (
                    <div className="wp-empty" role="status">
                      Loading workspaces…
                    </div>
                  ) : (
                    <div className="wp-space-grid">
                      {filtered.map((s, i) => (
                        <button
                          key={s.id}
                          disabled={busy}
                          className="wp-space-card"
                          onClick={() => chooseSpace(s.id)}
                        >
                          <div className={`wp-card-art wp-color-${i % 6}`}>
                            <FlowArt className="wp-card-flow" />
                            <span className="wp-card-monogram">{s.name.charAt(0).toUpperCase()}</span>
                            <span className="wp-card-arrow"><HubIcon name="arrow" size={18} /></span>
                          </div>
                          <div className="wp-space-card-body">
                            <h3>{s.name}</h3>
                            <div>
                              <span>
                                {s.role === "owner"
                                  ? "Owner"
                                  : "Member"}
                              </span>
                            <span className="wp-card-open">Open <HubIcon name="arrow" size={13} /></span>
                            </div>
                          </div>
                        </button>
                      ))}
                      {!query && (
                        <button
                          className="wp-space-card wp-create-card"
                          disabled={busy}
                          onClick={() => open("workspace")}
                        >
                          <span><HubIcon name="plus" size={26} /></span>
                          <h3>New workspace</h3>
                        </button>
                      )}
                    </div>
                  )}
                  {query && !filtered.length && (
                    <div className="wp-empty">
                      <h3>No matching workspaces</h3>
                      <button
                        className="wp-secondary"
                        onClick={() => setQuery("")}
                      >
                        Clear search
                      </button>
                    </div>
                  )}
                </>
              ) : !current && view !== "chat" ? (
                <div className="wp-empty" role="status">
                  {error
                    ? "Couldn’t load this workspace."
                    : "Loading workspace…"}
                </div>
              ) : view === "people" && current ? (
                <>
                  <section className="wp-page-heading">
                    <div>
                      <h1>People</h1>
                    </div>
                    {current.workspace.role === "owner" && (
                      <button
                        className="wp-primary"
                        disabled={busy}
                        onClick={() => open("invite")}
                      >
                        <HubIcon name="plus" size={16} />Invite
                      </button>
                    )}
                  </section>
                  <section className="wp-people-panel">
                    <div className="wp-panel-heading">
                      <h2>People</h2>
                      <span>{current.members.length}</span>
                    </div>
                    {current.members.map((m) => (
                      <div className="wp-person" key={m.userId}>
                        <span className="wp-avatar">
                          {m.displayName.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <strong>
                            {m.displayName}
                            {m.userId === userId ? " (you)" : ""}
                          </strong>
                          <small>
                            Joined {new Date(m.joinedAt).toLocaleDateString()}
                          </small>
                        </div>
                        <span className="wp-badge">{m.role}</span>
                        {current.workspace.role === "owner" && (
                          <button
                            className="wp-secondary"
                            disabled={
                              busy ||
                              (m.role === "owner" &&
                                current.members.filter(
                                  (person) => person.role === "owner",
                                ).length === 1)
                            }
                            onClick={() =>
                              void changeRole(
                                m.userId,
                                m.role === "owner" ? "member" : "owner",
                              )
                            }
                            title={
                              m.role === "owner"
                                  ? "At least one owner must remain"
                                  : "Owners can invite people, connect GitHub and approve agreements"
                            }
                          >
                            {m.role === "owner" ? "Make member" : "Make owner"}
                          </button>
                        )}
                      </div>
                    ))}
                  </section>
                  {current.workspace.role === "owner" ? (
                    <section className="wp-people-panel">
                      <div className="wp-panel-heading">
                        <h2>Invites</h2>
                        <span>{current.invitations.length}</span>
                      </div>
                      {current.invitations.length ? (
                        current.invitations.map((i) => (
                          <div className="wp-person" key={i.id}>
                            <span className="wp-avatar wp-invite-avatar">
                              <HubIcon name="mail" size={18} />
                            </span>
                            <div>
                              <strong>{i.email}</strong>
                              <small>
                                {i.status === "pending"
                                  ? `Expires ${new Date(i.expiresAt).toLocaleDateString()}`
                                  : i.status}
                              </small>
                            </div>
                            <span className="wp-badge">{i.status}</span>
                          </div>
                        ))
                      ) : (
                        <div className="wp-empty">
                          <h3>No invites</h3>
                          <button
                            className="wp-secondary"
                            onClick={() => open("invite")}
                          >
                            Invite
                          </button>
                        </div>
                      )}
                    </section>
                  ) : (
                    <p className="wp-dialog-copy">
                      Owners can invite people.
                    </p>
                  )}
                </>
              ) : (view === "contracts" || view === "conflicts") && current ? (
                <>
                  <section className="wp-page-heading">
                    <div>
                      <h1>
                        {view === "contracts"
                          ? "Agreements"
                          : "Issues"}
                      </h1>
                      {activeSpace === teamWorkspace && (
                        <a
                          className="wp-secondary"
                          href={`/workspaces/${activeSpace}/team`}
                        >
                          Team chat
                        </a>
                      )}
                    </div>
                  </section>
                  <section className="wp-people-panel">
                    {view === "contracts" ? (
                      current.contracts.length ? (
                        current.contracts.map((c) => (
                          <article
                            className="wp-person"
                            key={`${c.id}@${c.version}`}
                          >
                            <div>
                              <strong>
                                {c.method} {c.path}
                              </strong>
                              <small>
                                {c.name} · Version {c.version} · {c.status === "proposed" ? "Needs approval" : c.status === "superseded" ? "Replaced" : "Approved"}
                              </small>
                              <p>{c.response.map((f) => f.name).join(", ")}</p>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="wp-empty">
                          <h3>No agreements yet</h3>
                          {activeSpace === teamWorkspace && (
                            <a
                              className="wp-secondary"
                              href={`/workspaces/${activeSpace}/team`}
                            >
                              Team chat <HubIcon name="arrow" size={13} />
                            </a>
                          )}
                        </div>
                      )
                    ) : current.conflicts.length ? (
                      current.conflicts.map((c) => (
                        <article className="wp-person" key={c.id}>
                          <div>
                            <strong>{c.summary}</strong>
                            <small>
                              {c.status === "open" ? "Open" : c.status === "approved" ? "Agreement approved" : "Dismissed"} · {c.severity === "block" ? "Must fix" : "Warning"}
                            </small>
                            {c.evidence?.[0] && (
                              <p>
                                <code>
                                  {c.evidence[0].file}:{c.evidence[0].line}{" "}
                                  {c.evidence[0].snippet}
                                </code>
                              </p>
                            )}
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="wp-empty">
                        <h3>No issues reported</h3>
                        {activeSpace === teamWorkspace && (
                          <a
                            className="wp-secondary"
                            href={`/workspaces/${activeSpace}/team`}
                          >
                            Team chat <HubIcon name="arrow" size={13} />
                          </a>
                        )}
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <div className="wp-chat-layout">
                  <section className="wp-chat-panel">
                    <header className="wp-chat-heading">
                      <div>
                        <h1>{chat?.title ?? "Chat"}</h1>
                        <p>
                          <span className={`wp-status-dot ${syncState === "Synced" ? "is-synced" : ""}`} />{syncState === "Synced" ? "Up to date" : syncState === "Retrying" ? "Reconnecting…" : "Connecting…"}
                        </p>
                      </div>
                      <button
                        className="wp-secondary"
                        disabled={busy}
                        onClick={() => open("chat")}
                      >
                        <HubIcon name="plus" size={16} />New chat
                      </button>
                    </header>
                    <div className="wp-messages" aria-busy={loadingMessages}>
                      {(loadingMessages || !activeChat) && !visibleMessages.length ? (
                        <div className="chat-skeleton" role="status" aria-label="Loading chat">
                          <div /><div /><div />
                        </div>
                      ) : visibleMessages.length ? (
                        visibleMessages.map((m) => (
                          <article className={`wp-message chat-reactable ${m.author.userId === userId ? "wp-message-own" : ""}`} key={m.id}>
                            <span className="wp-avatar">
                              {m.author.name.charAt(0).toUpperCase()}
                            </span>
                            <div className="wp-message-stack">
                              <div className="wp-message-meta">
                                <strong>{m.author.name}</strong>
                                <small>
                                  {new Date(m.createdAt).toLocaleTimeString(
                                    [],
                                    { hour: "numeric", minute: "2-digit" },
                                  )}
                                </small>
                              </div>
                              <div className="wp-message-bubble">
                                {m.body && <p>{m.body}</p>}
                                <ChatImages workspaceId={activeSpace} images={m.images} />
                              </div>
                              <MessageReactions messageId={m.id} reactions={reactions} />
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="wp-empty">
                          <span className="wp-empty-symbol"><HubIcon name="spark" size={26} /></span>
                          <h2>No messages yet</h2>
                        </div>
                      )}
                      <div ref={bottom} />
                    </div>
                    {reactions.error && <p className="reaction-error" role="alert">{reactions.error}</p>}
                    <form
                      className="wp-composer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void send();
                      }}
                    >
                      <textarea
                        aria-label={`Message in ${chat?.title ?? "this chat"}`}
                        placeholder="Write a message"
                        rows={3}
                        maxLength={10000}
                        disabled={!chat || busy}
                        value={draft}
                        onChange={(e) => updateDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault();
                            void send();
                          }
                        }}
                      />
                      <ImagePicker key={`${userId}/${scope}`} workspaceId={activeSpace} images={draftImages}
                        disabled={busy || !chat}
                        onBusy={value => setUploadScope(value ? scope : "")}
                        onChange={images => {
                          if (userId !== userRef.current) return;
                          setDrafts(items => ({ ...items, [scope]: { body: items[scope]?.body ?? "", images, clientMessageId: crypto.randomUUID() } }));
                        }} />
                      <div>
                        <span>Workspace members only</span>
                        <button
                          className="wp-primary"
                          type="submit"
                          disabled={busy || uploading || !chat || (!draft.trim() && !draftImages.length)}
                        >
                          {busy ? "Sending…" : "Send"}<HubIcon name="send" size={16} />
                        </button>
                      </div>
                    </form>
                    <div className="wp-chat-footnote">
                      Enter to send · Shift + Enter for a new line
                    </div>
                  </section>
                  <aside className="wp-context">
                    <FlowArt className="wp-context-art" />
                    <span className="wp-context-icon"><HubIcon name="spark" size={25} /></span>
                    <h2>Workspace</h2>
                    <dl>
                      <div>
                        <dt>People</dt>
                        <dd>{current?.members.length ?? "…"}</dd>
                      </div>
                      <div>
                        <dt>Chats</dt>
                        <dd>{current?.chats.length ?? "…"}</dd>
                      </div>
                    </dl>
                    <button
                      className="wp-secondary"
                      disabled={busy}
                      onClick={() => setView("people")}
                    >
                      People<HubIcon name="arrow" size={14} />
                    </button>
                    <div className="wp-context-note">
                      {activeSpace === teamWorkspace && (
                        <a href={`/workspaces/${activeSpace}/team`}>
                          Team chat <HubIcon name="arrow" size={13} />
                        </a>
                      )}
                    </div>
                  </aside>
                </div>
              )}
              </div>
            </>
          )}
        </main>
      </div>
      {modal && session && accountReady && (
        <dialog
          ref={dialog}
          className="wp-dialog"
          aria-labelledby="wp-dialog-title"
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else setModal(null);
          }}
        >
          <div className="wp-dialog-heading">
            <h2 id="wp-dialog-title">
              {modal === "workspace"
                ? "New workspace"
                : modal === "chat"
                  ? "New chat"
                  : modal === "invite"
                    ? "Invite someone"
                    : "Share invite"}
            </h2>
            <button
              className="wp-icon-button"
              aria-label="Close"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              <HubIcon name="close" size={18} />
            </button>
          </div>
          {modal === "share" ? (
            <>
              <p className="wp-dialog-copy">
                Share this link with {field}. They must sign in with that verified email.
                It expires in 7 days. No email was sent.
              </p>
              {inviteUrl &&
                ["localhost", "127.0.0.1", "[::1]"].includes(
                  new URL(inviteUrl).hostname,
                ) && (
                  <p role="alert" className="wp-dialog-copy">
                    This link only works on this computer. Create a shareable link from your live site.
                  </p>
                )}
              <label className="wp-field">
                Invite link
                <input
                  readOnly
                  value={inviteUrl}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <button
                className="wp-primary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(inviteUrl)
                    .then(() => setNotice("Link copied."))
                    .catch(() =>
                      setFormError(
                        "Couldn’t copy. Select the link and copy it.",
                      ),
                    );
                }}
              >
                Copy link
              </button>
              <button
                className="wp-text-button wp-auth-switch"
                onClick={() => setModal(null)}
              >
                Done
              </button>
              {formError && <p role="alert">{formError}</p>}
            </>
          ) : (
            <form onSubmit={mutate}>
              {modal === "invite" && <p className="wp-dialog-copy">You’ll get a link to share. A new invite replaces any earlier link for that email.</p>}
              <label className="wp-field">
                {modal === "workspace"
                  ? "Workspace name"
                  : modal === "chat"
                    ? "Chat name"
                    : "Email"}
                <input
                  autoFocus
                  type={modal === "invite" ? "email" : "text"}
                  required
                  maxLength={modal === "invite" ? 254 : 80}
                  disabled={busy}
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                />
              </label>
              {formError && (
                <p className="wp-alert" role="alert">
                  {formError}
                </p>
              )}
              <div className="wp-dialog-actions">
                <button
                  type="button"
                  className="wp-secondary"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="wp-primary"
                  disabled={busy || !field.trim()}
                >
                  {busy
                    ? "Saving…"
                    : modal === "workspace"
                      ? "Create workspace"
                      : modal === "chat"
                        ? "Create chat"
                        : "Create invite"}
                </button>
              </div>
            </form>
          )}
        </dialog>
      )}
    </div>
  );
}
