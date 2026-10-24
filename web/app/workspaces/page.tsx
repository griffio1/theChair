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
import type {
  Workspace,
  WorkspaceChat,
  WorkspaceDetail,
  WorkspaceInvitation,
  WorkspaceMessage,
} from "../../lib/workspace-types";
import "./workspaces.css";

type View = "home" | "chat" | "people" | "contracts" | "conflicts";
type Draft = { body: string; clientMessageId: string };
type Modal = "workspace" | "chat" | "invite" | "share";

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
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "The request failed. Please try again.",
    );
  return result as T;
}
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";

function AccountForm({ invited }: { invited: boolean }) {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
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
            },
          })
        : await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
      if (result.error) throw result.error;
      setPassword("");
      if (signup && !result.data.session)
        setNotice(
          "Check your email to confirm your account, then sign in here. Your invitation will wait in this tab.",
        );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wp-account-card">
      <div className="wp-eyebrow">A SEAT AT THE TABLE</div>
      <h1>{signup ? "Let’s build together." : "Welcome back."}</h1>
      <p className="wp-dialog-copy">
        {invited
          ? "Sign in with the email address that received the invitation to join your team."
          : "Sign in to see your workspaces, conversations, and people."}
      </p>
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
          Email address
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
        <button className="wp-primary" disabled={busy} type="submit">
          {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
        </button>
        <button
          className="wp-text-button wp-auth-switch"
          type="button"
          disabled={busy}
          onClick={() => {
            setSignup(!signup);
            setError("");
            setNotice("");
          }}
        >
          {signup
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
      </form>
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
  const [view, setView] = useState<View>("home");
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
  const visibleMessages = history.scope === scope ? history.items : [];
  const draft = drafts[scope]?.body ?? "";
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
    setActiveSpace("");
    setActiveChat("");
    setHistory({ scope: "", items: [] });
    setDrafts({});
    setView("home");
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
        const binding = await supabase
          .from("chair_legacy_binding")
          .select("workspace_id")
          .eq("workspace_id", activeSpace)
          .maybeSingle();
        if (ctrl.signal.aborted) return;
        setTeamWorkspace(
          binding.error ? "" : (binding.data?.workspace_id ?? ""),
        );
        setActiveChat((id) =>
          result.chats.some((c) => c.id === id)
            ? id
            : (result.chats[0]?.id ?? ""),
        );
      } catch (e) {
        if (!ctrl.signal.aborted) setError(errorText(e));
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
    if (!activeSpace || !activeChat || !userId || !chat) return;
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
    chat?.id,
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
        setNotice("Workspace created. Invite your team when you’re ready.");
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
          throw new Error("The invitation link was missing. Try again.");
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
    if (!item?.body.trim() || busy || !chat) return;
    const actor = userId;
    const key = scope;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ messages: WorkspaceMessage[] }>(
        `/api/workspaces/${activeSpace}/chats/${activeChat}/messages`,
        item,
      );
      if (actor !== userRef.current) return;
      mergeMessages(key, result.messages);
      setDrafts((items) =>
        items[key]?.clientMessageId === item.clientMessageId
          ? {
              ...items,
              [key]: { body: "", clientMessageId: crypto.randomUUID() },
            }
          : items,
      );
      setSyncState("Synced");
    } catch (e) {
      if (actor === userRef.current)
        setError(
          `${errorText(e)} Your draft is still here; retrying won’t duplicate the message.`,
        );
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
      setNotice("You’ve joined the workspace.");
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
      [scope]: { body, clientMessageId: crypto.randomUUID() },
    }));
  }

  const filtered = spaces.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="workspace-hub wp-live">
      <aside className="wp-sidebar" aria-label="Workspace navigation">
        <a className="wp-brand" href="/workspaces">
          <span className="wp-brand-mark">↳</span>theChair
          <span className="wp-dot">.</span>
        </a>
        {session && accountReady && (
          <>
            <label className="wp-space-picker">
              <span>SWITCH WORKSPACE</span>
              <select
                aria-label="Switch workspace"
                value={activeSpace}
                disabled={busy || !spaces.length}
                onChange={(e) => chooseSpace(e.target.value)}
              >
                {!spaces.length && (
                  <option value="">Your first workspace</option>
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
                  ["home", "▦", "All workspaces"],
                  ["people", "♧", "People & invites"],
                  ["contracts", "≡", "Contracts"],
                  ["conflicts", "△", "Conflicts"],
                ] as const
              ).map(([key, icon, label]) => (
                <button
                  key={key}
                  className={view === key ? "active" : ""}
                  disabled={busy || (key !== "home" && !activeSpace)}
                  onClick={() => setView(key)}
                >
                  <span className="wp-glyph" aria-hidden="true">
                    {icon}
                  </span>
                  {label}
                </button>
              ))}
              {activeSpace === teamWorkspace && teamWorkspace && (
                <a href="/team">Team agreements & AI chat ↗</a>
              )}
            </nav>
            <div className="wp-section-label">
              <span>CONVERSATIONS</span>
              <button
                className="wp-icon-button"
                disabled={busy || !current}
                onClick={() => open("chat")}
                aria-label="New chat"
              >
                +
              </button>
            </div>
            <nav className="wp-threads" aria-label="Conversations">
              {current?.chats.map((c) => (
                <button
                  key={c.id}
                  className={
                    view === "chat" && activeChat === c.id ? "active" : ""
                  }
                  disabled={busy}
                  onClick={() => {
                    setActiveChat(c.id);
                    setView("chat");
                    setError("");
                  }}
                >
                  <span className="wp-glyph" aria-hidden="true">
                    ▤
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
              + New workspace
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
            <a className="wp-legacy-link" href="/team">
              Team agreements & AI chat ↗
            </a>
          )}
        </div>
      </aside>
      <div className="wp-main">
        <header className="wp-topbar">
          <div className="wp-breadcrumb">
            <span>{space?.name ?? "theChair"}</span>
            <span>/</span>
            <strong>
              {view === "home"
                ? "Workspaces"
                : view === "chat"
                  ? (chat?.title ?? "Conversation")
                  : view === "people"
                    ? "People"
                    : view === "contracts"
                      ? "Contracts"
                      : "Conflicts"}
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
                  Retry loading
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
                    <strong>You have an invitation</strong>
                    <p>
                      Accept with the verified email it was addressed to. Signed
                      in as {session.user.email}.
                    </p>
                  </div>
                  <button
                    className="wp-primary"
                    disabled={busy}
                    onClick={() => void join()}
                  >
                    {busy ? "Please wait…" : "Accept invitation"}
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
              {view === "home" ? (
                <>
                  <section className="wp-page-heading">
                    <div>
                      <div className="wp-eyebrow">ROOM TO BUILD TOGETHER</div>
                      <h1>
                        Your work, in good company<span>.</span>
                      </h1>
                      <p>
                        A space for every project. A conversation for every
                        idea.
                      </p>
                    </div>
                    <button
                      className="wp-primary"
                      disabled={busy}
                      onClick={() => open("workspace")}
                    >
                      + New workspace
                    </button>
                  </section>
                  <div className="wp-list-toolbar">
                    <h2>
                      Your workspaces <span>{spaces.length}</span>
                    </h2>
                    <label className="wp-search">
                      <input
                        type="search"
                        aria-label="Search workspaces"
                        placeholder="Find a workspace…"
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
                            <span>{s.name.charAt(0).toUpperCase()}</span>
                            <span className="wp-card-arrow">↗</span>
                          </div>
                          <div className="wp-space-card-body">
                            <h3>{s.name}</h3>
                            <p>
                              Conversations, people, and shared understanding.
                            </p>
                            <div>
                              <span>
                                {s.role === "owner"
                                  ? "You own this workspace"
                                  : "Team member"}
                              </span>
                              <span className="wp-badge">Open workspace</span>
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
                          <span>+</span>
                          <h3>
                            {spaces.length
                              ? "Make room for something new"
                              : "Create your first workspace"}
                          </h3>
                          <p>Start a project and invite your people.</p>
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
              ) : !current ? (
                <div className="wp-empty" role="status">
                  {error
                    ? "This workspace couldn’t be loaded."
                    : "Loading workspace…"}
                </div>
              ) : view === "people" ? (
                <>
                  <section className="wp-page-heading">
                    <div>
                      <div className="wp-eyebrow">BETTER WITH YOUR PEOPLE</div>
                      <h1>
                        A seat at the table<span>.</span>
                      </h1>
                      <p>Everyone building in {current.workspace.name}.</p>
                    </div>
                    {current.workspace.role === "owner" && (
                      <button
                        className="wp-primary"
                        disabled={busy}
                        onClick={() => open("invite")}
                      >
                        + Invite someone
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
                      </div>
                    ))}
                  </section>
                  {current.workspace.role === "owner" ? (
                    <section className="wp-people-panel">
                      <div className="wp-panel-heading">
                        <h2>Invitations</h2>
                        <span>{current.invitations.length}</span>
                      </div>
                      {current.invitations.length ? (
                        current.invitations.map((i) => (
                          <div className="wp-person" key={i.id}>
                            <span className="wp-avatar wp-invite-avatar">
                              @
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
                          <h3>Better together</h3>
                          <p>
                            Create an invitation link for your teammate’s email
                            address. You choose how to share it.
                          </p>
                          <button
                            className="wp-secondary"
                            onClick={() => open("invite")}
                          >
                            Invite someone
                          </button>
                        </div>
                      )}
                    </section>
                  ) : (
                    <p className="wp-dialog-copy">
                      Workspace owners can invite more people.
                    </p>
                  )}
                </>
              ) : view === "contracts" || view === "conflicts" ? (
                <>
                  <section className="wp-page-heading">
                    <div>
                      <div className="wp-eyebrow">{current.workspace.name}</div>
                      <h1>
                        {view === "contracts"
                          ? "Your shared agreements."
                          : "Keep everyone aligned."}
                      </h1>
                      <p>Only this workspace’s {view} appear here.</p>
                      {activeSpace === teamWorkspace && (
                        <a className="wp-secondary" href="/team">
                          Open team agreements & approvals
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
                                {c.name} · v{c.version} · {c.status}
                              </small>
                              <p>{c.response.map((f) => f.name).join(", ")}</p>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="wp-empty">
                          <h3>No contracts in this workspace yet</h3>
                          <p>
                            {activeSpace === teamWorkspace
                              ? "Propose your first agreement in the team AI chat."
                              : "No repository agent is connected to this workspace yet."}
                          </p>
                          {activeSpace === teamWorkspace && (
                            <a className="wp-secondary" href="/team">
                              Open team agreements ↗
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
                              {c.status} · {c.severity}
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
                        <h3>No workspace conflict reports</h3>
                        <p>
                          {activeSpace === teamWorkspace
                            ? "Your agents have no conflict reports for this workspace."
                            : "No repository agent is connected to this workspace yet."}
                        </p>
                        {activeSpace === teamWorkspace && (
                          <a className="wp-secondary" href="/team">
                            View team activity ↗
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
                        <div className="wp-eyebrow">
                          {current.workspace.name}
                        </div>
                        <h1>{chat?.title ?? "Conversation"}</h1>
                        <p>
                          {syncState} · latest 200 messages · refreshes every 5
                          seconds
                        </p>
                      </div>
                      <button
                        className="wp-secondary"
                        disabled={busy}
                        onClick={() => open("chat")}
                      >
                        + New chat
                      </button>
                    </header>
                    <div className="wp-messages" aria-busy={loadingMessages}>
                      {loadingMessages && !visibleMessages.length ? (
                        <div className="wp-empty" role="status">
                          Loading conversation…
                        </div>
                      ) : visibleMessages.length ? (
                        visibleMessages.map((m) => (
                          <article className="wp-message" key={m.id}>
                            <span className="wp-avatar">
                              {m.author.name.charAt(0).toUpperCase()}
                            </span>
                            <div>
                              <div className="wp-message-meta">
                                <strong>{m.author.name}</strong>
                                <small>
                                  {new Date(m.createdAt).toLocaleTimeString(
                                    [],
                                    { hour: "numeric", minute: "2-digit" },
                                  )}
                                </small>
                              </div>
                              <p>{m.body}</p>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="wp-empty">
                          <span className="wp-empty-symbol">✳</span>
                          <h2>Start something together</h2>
                          <p>
                            Share a plan, ask a question, or welcome your team.
                            Messages are shared with this workspace’s members.
                          </p>
                          <div className="wp-prompts">
                            {[
                              "What are we building?",
                              "Let’s plan the login flow",
                              "What should we tackle next?",
                            ].map((p) => (
                              <button key={p} onClick={() => updateDraft(p)}>
                                {p} ↗
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div ref={bottom} />
                    </div>
                    <form
                      className="wp-composer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void send();
                      }}
                    >
                      <textarea
                        aria-label={`Message in ${chat?.title ?? "this conversation"}`}
                        placeholder="Share a plan. Start a conversation."
                        rows={3}
                        maxLength={10000}
                        disabled={!chat}
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
                      <div>
                        <span>Shared with workspace members</span>
                        <button
                          className="wp-primary"
                          type="submit"
                          disabled={busy || !chat || !draft.trim()}
                        >
                          {busy ? "Sending…" : "Send message ↑"}
                        </button>
                      </div>
                    </form>
                    <div className="wp-chat-footnote">
                      Enter to send · Shift + Enter for a new line
                    </div>
                  </section>
                  <aside className="wp-context">
                    <span className="wp-context-icon">✳</span>
                    <h2>On the same page.</h2>
                    <p>
                      A place for your people and the ideas you’re building
                      together.
                    </p>
                    <dl>
                      <div>
                        <dt>People</dt>
                        <dd>{current.members.length}</dd>
                      </div>
                      <div>
                        <dt>Conversations</dt>
                        <dd>{current.chats.length}</dd>
                      </div>
                    </dl>
                    <button
                      className="wp-secondary"
                      disabled={busy}
                      onClick={() => setView("people")}
                    >
                      People & invites ↗
                    </button>
                    <div className="wp-context-note">
                      <strong>Team conversation</strong>
                      <p>
                        These conversations are shared only with this
                        workspace’s members.
                      </p>
                      {activeSpace === teamWorkspace && (
                        <a href="/team">Team agreements & AI chat ↗</a>
                      )}
                    </div>
                  </aside>
                </div>
              )}
            </>
          )}
        </main>
        <footer className="wp-footer">
          theChair · Git merges code. We merge intent.
          <span>More room for everyone ✳</span>
        </footer>
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
                ? "Make room for your team"
                : modal === "chat"
                  ? "Start a conversation"
                  : modal === "invite"
                    ? "Bring someone in"
                    : "Your invitation is ready"}
            </h2>
            <button
              className="wp-icon-button"
              aria-label="Close dialog"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              ×
            </button>
          </div>
          {modal === "share" ? (
            <>
              <p className="wp-dialog-copy">
                Copy and share this link with {field}. They must sign in with
                that verified email. The link expires in 7 days. No invitation
                email was sent.
              </p>
              <label className="wp-field">
                Invitation link
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
                    .then(() => setNotice("Invitation link copied."))
                    .catch(() =>
                      setFormError(
                        "Clipboard unavailable. Select the link above and copy it manually.",
                      ),
                    );
                }}
              >
                Copy invitation link
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
              <p className="wp-dialog-copy">
                {modal === "workspace"
                  ? "A workspace brings your people and conversations together. We’ll create a General chat to get you started."
                  : modal === "chat"
                    ? `Start a conversation in ${space?.name}.`
                    : "Create a member invitation tied to their email. You’ll get a link to share. Creating another link for the same email replaces its previous invitation."}
              </p>
              <label className="wp-field">
                {modal === "workspace"
                  ? "Workspace name"
                  : modal === "chat"
                    ? "Conversation name"
                    : "Teammate’s email"}
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
                        : "Create invitation link"}
                </button>
              </div>
            </form>
          )}
        </dialog>
      )}
    </div>
  );
}
