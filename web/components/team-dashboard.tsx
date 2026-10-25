"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import WorkspaceConnections from "./workspace-connections";
import { AppearancePicker } from "../components/appearance-picker";
import { FlowArt } from "./flow-art";
import { ChatImages, ImagePicker } from "./chat-images";
import type { ChatImage } from "../lib/workspace-types";
import { MessageReactions, useConversationReactions } from "./chat-reactions";
import { Markdown } from "./markdown";
import { mergeTeamMessages, teamMessageRows, type TeamMessageRow } from "../lib/team-messages";

type Row = Record<string, any>;
type View = "chat" | "conflicts" | "contracts";

type IconName =
  | "chat"
  | "conflicts"
  | "contracts"
  | "arrow"
  | "check"
  | "chevron"
  | "code"
  | "sun"
  | "moon";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    moon: <path d="M20.5 13.5A8.5 8.5 0 0 1 10.5 3a8.5 8.5 0 1 0 10 10.5Z" />,
    chat: (
      <>
        <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z" />
        <path d="M7 9h9M7 13h6" />
      </>
    ),
    conflicts: (
      <>
        <path d="m12 3 10 18H2L12 3Z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
    contracts: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    arrow: (
      <>
        <path d="M12 19V5m-6 6 6-6 6 6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    code: (
      <>
        <path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-11-2 14" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function ContractCard({
  contract,
  compact = false,
}: {
  contract: Row;
  compact?: boolean;
}) {
  return (
    <article className={`contract-card ${compact ? "compact" : ""}`}>
      <div className="card-topline">
        <span className="method">{contract.method}</span>
        <span className="version">v{contract.version}</span>
      </div>
      <h3 className="endpoint">{contract.path}</h3>
      <div className="contract-name">
        {contract.id}
        <span className="approved-mark">
          <Icon name="check" size={12} /> Approved
        </span>
      </div>
      <div className="field-group">
        <span className="field-label">Receives</span>
        <div className="field-list">
          {contract.request?.map((f: Row) => (
            <code key={f.name}>
              {f.name}
              <span>{f.type}</span>
            </code>
          ))}
        </div>
      </div>
      <div className="field-group">
        <span className="field-label">Returns</span>
        <div className="field-list">
          {contract.response?.map((f: Row) => (
            <code key={f.name}>
              {f.name}
              <span>{f.type}</span>
            </code>
          ))}
        </div>
      </div>
      {contract.owner && (
        <div className="contract-footer">
          <span className="tiny-avatar">
            {String(contract.owner).slice(0, 1).toUpperCase()}
          </span>
          Owner: {contract.owner}
        </div>
      )}
    </article>
  );
}

export default function TeamDashboard({
  name,
  userId,
  workspaceId,
  workspaceName,
  canApprove,
}: {
  name: string;
  userId: string;
  workspaceId: string;
  workspaceName: string;
  canApprove: boolean;
}) {
  const [messages, setMessages] = useState<TeamMessageRow[]>([]);
  const [conflicts, setConflicts] = useState<Record<string, Row>>({});
  const [contracts, setContracts] = useState<Row[]>([]);
  const [draft, setDraft] = useState("");
  const [draftImages, setDraftImages] = useState<ChatImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const imageMessageId = useRef("");
  const me = name;
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const [connection, setConnection] = useState("Connecting");
  const [loading, setLoading] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(true);
  const reactions = useConversationReactions(workspaceId, "team", userId, view !== "contracts" && messages.length > 0);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const refreshConversation = useRef<() => void>(() => {});
  const ledgerRevision = useRef(0);

  async function authHeaders() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Sign in again");
    return {
      "content-type": "application/json",
      "x-thechair-workspace": workspaceId,
      authorization: `Bearer ${data.session.access_token}`,
    };
  }

  async function loadContracts(signal?: AbortSignal) {
    const { data, error } = await supabase
      .from("contracts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("id")
      .order("version", { ascending: false }).abortSignal(signal ?? AbortSignal.timeout(15000));
    if (error) throw error;
    return data ?? [];
  }

  useEffect(() => {
    let active = true;
    let messagesInFlight = false;
    let ledgerInFlight = false;
    const ctrl = new AbortController();
    setLoading(true);
    setLoadingLedger(true);
    async function loadMessages() {
      if (messagesInFlight || !active) return;
      messagesInFlight = true;
      try {
        const { data: m, error: messageError } = await supabase
          .from("messages")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(200).abortSignal(AbortSignal.any([ctrl.signal, AbortSignal.timeout(15000)]));
        if (messageError) throw messageError;
        if (active) {
          setMessages(previous => mergeTeamMessages(previous, m ?? []));
          setError(previous => previous === "Chat couldn’t load. Retrying…" ? "" : previous);
        }
      } catch {
        if (active) setError("Chat couldn’t load. Retrying…");
      } finally {
        messagesInFlight = false;
        if (active) setLoading(false);
      }
    }
    async function loadLedger() {
      if (ledgerInFlight || !active) return;
      ledgerInFlight = true;
      const revision = ledgerRevision.current;
      try {
        const signal = AbortSignal.any([ctrl.signal, AbortSignal.timeout(15000)]);
        const [result, nextContracts] = await Promise.all([
          supabase.from("conflicts").select("*").eq("workspace_id", workspaceId).abortSignal(signal),
          loadContracts(signal),
        ]);
        if (result.error) throw result.error;
        if (active && revision === ledgerRevision.current) {
          setConflicts(Object.fromEntries((result.data ?? []).map(row => [row.id,row])));
          setContracts(nextContracts);
          setError(previous => previous === "Details couldn’t load. Chat still works." ? "" : previous);
        }
      } catch { if (active) setError("Details couldn’t load. Chat still works."); }
      finally {
        ledgerInFlight = false;
        if (active) {
          // Events and approvals may have changed the ledger while this snapshot was in flight.
          if (revision !== ledgerRevision.current) void loadLedger();
          else setLoadingLedger(false);
        }
      }
    }
    function refresh() { void loadMessages(); void loadLedger(); }
    refreshConversation.current = refresh;
    void loadMessages();
    void loadLedger();
    const ch = supabase
      .channel(`thechair:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (p) => { if (active) setMessages(prev => mergeTeamMessages(prev, [p.new as TeamMessageRow])); },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conflicts",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (p) => {
          if (!active) return;
          ledgerRevision.current++;
          setConflicts((prev) => {
            const next = { ...prev };
            if (p.eventType === "DELETE") delete next[p.old.id];
            else next[p.new.id] = p.new;
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contracts",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => { if (active) { ledgerRevision.current++; void loadLedger(); } },
      )
      .subscribe((status) => {
        if (!active) return;
        setConnection(
          status === "SUBSCRIBED"
            ? "Live"
            : status === "CHANNEL_ERROR" ||
                status === "TIMED_OUT" ||
                status === "CLOSED"
              ? "Reconnecting"
              : "Connecting",
        );
        // Reload after reconnecting: events sent while offline are not replayed.
        if (status === "SUBSCRIBED") refresh();
      });
    const poll = setInterval(() => { if (!document.hidden) refresh(); }, 10000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => {
      active = false;
      ctrl.abort();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      refreshConversation.current = () => {};
      void supabase.removeChannel(ch);
    };
  }, [workspaceId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, view]);

  async function send() {
    if ((!draft.trim() && !draftImages.length) || busy || uploading) return;
    setBusy(true);
    setError("");
    const body = draft;
    try {
      if (!imageMessageId.current) imageMessageId.current = crypto.randomUUID();
      const response = await fetch(draftImages.length ? `/api/workspaces/${workspaceId}/team/images` : "/api/chat", {
        method: "POST",
        signal: AbortSignal.timeout(45000),
        headers: await authHeaders(),
        body: JSON.stringify(draftImages.length
          ? { body, clientMessageId: imageMessageId.current, imageIds: draftImages.map(image => image.id) }
          : { author: me, body }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Couldn’t send. Try again.");
      }
      const sent = teamMessageRows(draftImages.length ? result.messages : result);
      setMessages(previous => mergeTeamMessages(previous, sent));
      refreshConversation.current();
      setDraft(""); setDraftImages([]); imageMessageId.current = "";
    } catch (error) {
      refreshConversation.current();
      setError(`${error instanceof Error ? error.message : "Send not confirmed."} Check the chat before retrying. Your draft is still here.`);
    } finally {
      setBusy(false);
    }
  }

  async function approve(
    kind: "conflict" | "contract",
    id: string,
    version?: number,
  ) {
    const key = `${kind}:${id}`;
    ledgerRevision.current++;
    setPending(key);
    setError("");
    try {
      const response = await fetch(
        `/api/${kind === "conflict" ? "conflicts" : "contracts"}/${encodeURIComponent(id)}/approve`,
        {
          method: "POST",
          signal: AbortSignal.timeout(45000),
          headers: await authHeaders(),
          body: JSON.stringify(
            kind === "conflict"
              ? { approvedBy: me }
              : { version, approvedBy: me },
          ),
        },
      );
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.error || "Couldn’t approve.");
      }
      const revision = ++ledgerRevision.current;
      if (kind === "contract") {
        const next = await loadContracts();
        if (revision === ledgerRevision.current) setContracts(next);
      }
      else {
        const { data, error } = await supabase
          .from("conflicts")
          .select("*")
          .eq("workspace_id", workspaceId);
        if (error) throw error;
        if (revision === ledgerRevision.current) setConflicts(Object.fromEntries((data ?? []).map((c) => [c.id, c])));
      }
    } catch (error) {
      setError(
        `${error instanceof Error ? error.message : "Approval not confirmed."} Refresh before retrying.`,
      );
    } finally {
      setPending(null);
      refreshConversation.current();
    }
  }

  // Rows arrive newest first; retain the first approved version for each id.
  const approved = [
    ...contracts
      .filter((c) => c.status === "approved")
      .reduce((map, c) => {
        if (!map.has(c.id)) map.set(c.id, c);
        return map;
      }, new Map<string, Row>())
      .values(),
  ];
  const openCount = Object.values(conflicts).filter(
    (c) => c.status === "open",
  ).length;
  const caught = Object.values(conflicts).filter(
    (c) => c.severity === "block",
  ).length;
  const visibleMessages =
    view === "conflicts"
      ? messages.filter((m) => m.kind === "conflict")
      : messages;

  function renderMessage(m: Row) {
    if (m.kind === "conflict") {
      const c = conflicts[m.ref_id];
      const open = c?.status === "open";
      return (
        <article
          key={m.id}
          className={`event-card chat-reactable ${open ? "conflict-card" : c ? "resolved-card" : ""}`}
        >
          <div className="event-heading">
            <span className="event-icon">
              <Icon name={open ? "conflicts" : c ? "check" : "contracts"} size={16} />
            </span>
            <strong>
              {open
                ? "Issue found"
                : c?.status === "approved"
                  ? "Agreement approved"
                  : c?.status === "dismissed"
                    ? "Issue dismissed"
                  : "Code check"}
            </strong>
            <span className={`badge ${open ? "badge-warn" : "badge-neutral"}`}>
              {open ? "Open" : c?.status === "approved" ? "Approved" : c?.status === "dismissed" ? "Dismissed" : "Saved"}
            </span>
          </div>
          <p className="event-copy">{m.body}</p>
          {c?.evidence?.[0] && (
            <div className="code-evidence">
              <span>
                {c.evidence[0].file}:{c.evidence[0].line}
              </span>
              <code>{c.evidence[0].snippet}</code>
            </div>
          )}
          {c?.suggested_fix && (
            <p className="suggestion">
              <Icon name="code" size={15} />
              <span>{c.suggested_fix}</span>
            </p>
          )}
          <MessageReactions messageId={m.id} reactions={reactions} />
          <div className="event-footer">
            <span>
              {c?.agent ?? "AI tool"}
              {c?.developer ? ` · ${c.developer}` : ""}
              {c?.detected_by === "preflight" || c?.detected_by === "hook" ? " · Before editing" : c?.detected_by === "webhook" ? " · After a code update" : ""}
            </span>
            {open && canApprove && (
              <button
                className="button-dark button-small"
                disabled={pending !== null}
                onClick={() => void approve("conflict", c.id)}
                aria-label={`Approve agreement for ${c.summary ?? "this issue"}`}
              >
                {pending === `conflict:${c.id}` ? "Approving…" : "Approve"}
                <Icon name="chevron" size={13} />
              </button>
            )}
          </div>
          {(open || c?.status === "approved") && <p className="event-copy">Approval doesn’t change the code. Apply the fix, then check again.</p>}
        </article>
      );
    }
    if (m.kind === "contract_proposal") {
      const [id, version] = String(m.ref_id).split("@");
      const c = contracts.find(
        (x) => x.id === id && String(x.version) === version,
      );
      return (
        <article key={m.id} className="event-card proposal-card chat-reactable">
          <div className="event-heading">
            <span className="event-icon">
              <Icon name="contracts" size={16} />
            </span>
            <strong>New agreement</strong>
            <span className="badge badge-neutral">
              {c?.status === "approved" ? "Approved" : c?.status === "superseded" ? "Replaced" : "Needs approval"}
            </span>
          </div>
          {c && (
            <div className="proposal-endpoint">
              <span className="method">{c.method}</span>
              <code>{c.path}</code>
              <span className="version">v{c.version}</span>
            </div>
          )}
          <p className="event-copy">{m.body}</p>
          <MessageReactions messageId={m.id} reactions={reactions} />
          <div className="event-footer">
            <span>{id}</span>
            {c?.status === "proposed" && canApprove && (
              <button
                className="button-dark button-small"
                disabled={pending !== null}
                onClick={() => void approve("contract", id, Number(version))}
                aria-label={`Approve ${id}, version ${version}`}
              >
                {pending === `contract:${id}`
                  ? "Approving…"
                  : "Approve"}
                <Icon name="chevron" size={13} />
              </button>
            )}
          </div>
        </article>
      );
    }
    const system = m.author_type === "system";
    const ai = m.author_type === "ai";
    return (
      <article
        key={m.id}
        className={`message chat-reactable ${system ? "system-message" : ""} ${ai ? "message-ai" : ""}`}
      >
        <div className={`avatar ${ai || system ? "ai-avatar" : ""}`}>
          {ai || system ? (
            <ChairMark />
          ) : (
            String(m.author_name || "?")
              .slice(0, 1)
              .toUpperCase()
          )}
        </div>
        <div className="message-content">
          <div className="message-meta">
            <strong>{m.author_name}</strong>
            {ai && <span className="ai-label">AI</span>}
            {system && <span className="ai-label">System</span>}
          </div>
          <div className="team-message-bubble">
            {m.body && <div className="message-body">{ai ? <Markdown text={m.body} /> : m.body}</div>}
            <ChatImages workspaceId={workspaceId} images={m.images} />
          </div>
          <MessageReactions messageId={m.id} reactions={reactions} />
        </div>
      </article>
    );
  }

  return (
    <div className="workspace">
      <aside className="sidebar" aria-label="Workspace navigation">
        <a className="brand" href="/" aria-label="theChair home">
          <span className="brand-mark">
            <ChairMark />
          </span>
          <span>
            theChair<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="project-icon">{workspaceName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{workspaceName}</strong>
            <span>Team</span>
          </div>
        </div>
        <nav>
          {(
            [
              { key: "chat", label: "Team chat", icon: "chat" },
              { key: "conflicts", label: "Issues", icon: "conflicts" },
              { key: "contracts", label: "Agreements", icon: "contracts" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              className={`nav-item ${view === item.key ? "active" : ""}`}
              onClick={() => setView(item.key)}
              aria-current={view === item.key ? "page" : undefined}
              title={item.label}
              aria-label={item.label}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.key === "conflicts" && openCount > 0 && (
                <span className="nav-count">{openCount}</span>
              )}
            </button>
          ))}
        </nav>
        <a
          className="nav-item"
          href="/workspaces"
          aria-label="Workspaces"
          title="Workspaces"
        >
          <Icon name="chat" />
          <span>Workspaces ↗</span>
        </a>
        <div className="profile">
          <span className="avatar profile-avatar">
            {me.slice(0, 1).toUpperCase() || "?"}
          </span>
          <label>
            <input aria-label="Your name" value={me} readOnly />
          </label>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="breadcrumb-root">Workspace</span>
            <Icon name="chevron" size={12} />
            <strong>
              {view === "chat"
                ? "Team chat"
                : view === "conflicts"
                  ? "Issues"
                  : "Agreements"}
            </strong>
          </div>
          <AppearancePicker />
          <label className="compact-profile">
            <span>You</span>
            <input aria-label="Your name" value={me} readOnly />
          </label>
          <span
            className={`connection ${connection === "Live" ? "is-live" : ""}`}
            role="status"
          >
            <span />
            {connection}
          </span>
        </header>
        <main className="dashboard">
          <section className="overview" aria-label="Workspace overview">
            <div>
              <h1>{workspaceName}</h1>
            </div>
            <FlowArt className="overview-art" />
          </section>
          {canApprove && <WorkspaceConnections workspaceId={workspaceId} />}
          <div className="metrics">
            <button
              className={`metric ${view === "contracts" ? "selected" : ""}`}
              onClick={() => setView("contracts")}
            >
              <span className="metric-icon">
                <Icon name="contracts" />
              </span>
              <span>
                <strong>
                  {loadingLedger ? "—" : String(approved.length).padStart(2, "0")}
                </strong>
                <span>Agreements</span>
              </span>
              <Icon name="chevron" size={14} />
            </button>
            <button
              className={`metric ${view === "conflicts" ? "selected" : ""}`}
              onClick={() => setView("conflicts")}
            >
              <span
                className={`metric-icon ${openCount ? "metric-amber" : ""}`}
              >
                <Icon name="conflicts" />
              </span>
              <span>
                <strong>
                  {loadingLedger ? "—" : String(openCount).padStart(2, "0")}
                </strong>
                <span>Open issues</span>
              </span>
              <Icon name="chevron" size={14} />
            </button>
            <div className="metric">
              <span className="metric-icon metric-green">
                <Icon name="check" />
              </span>
              <span>
                <strong>
                  {loadingLedger ? "—" : String(caught).padStart(2, "0")}
                </strong>
                <span>Issues caught</span>
              </span>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <Icon name="conflicts" size={16} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {reactions.error && <p className="reaction-error" role="alert">{reactions.error}</p>}
          <div
            key={view}
            className={`content-grid view-enter ${view === "contracts" ? "contracts-view" : ""}`}
          >
            <section
              className="main-panel"
              aria-label={
                view === "chat"
                  ? "Team chat"
                  : view === "conflicts"
                    ? "Issues"
                    : "Agreements"
              }
            >
              <div className="panel-header">
                <div>
                  <h2>
                    {view === "chat"
                      ? "Team chat"
                      : view === "conflicts"
                        ? "Issues"
                        : "Agreements"}
                  </h2>
                </div>
                {view !== "chat" && <span className="panel-tag">
                  {view === "conflicts" ? `${openCount} open` : `${approved.length} approved`}
                </span>}
              </div>
              {view === "contracts" ? (
                <div className="ledger-grid">
                  {approved.map((c) => (
                    <ContractCard key={c.id} contract={c} />
                  ))}
                  {!loadingLedger && approved.length === 0 && (
                    <EmptyState
                      icon="contracts"
                      title="No agreements yet"
                      text="Describe what the code should send and return in Team chat."
                    />
                  )}
                  {loadingLedger && (
                    <p className="loading-state" role="status">
                      Loading agreements…
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div
                    className="conversation"
                    aria-live="polite"
                    aria-busy={loading}
                  >
                    {loading && !visibleMessages.length ? (
                      <p className="loading-state" role="status">
                        Loading…
                      </p>
                    ) : visibleMessages.length === 0 ? (
                      <EmptyState
                        icon={view === "chat" ? "chat" : "check"}
                        title={
                          view === "chat"
                            ? "No messages yet"
                            : "No issues yet"
                        }
                        text={
                          view === "chat"
                            ? "Send a message to your team and AI."
                            : ""
                        }
                      />
                    ) : (
                      visibleMessages.map(renderMessage)
                    )}
                    <div ref={bottom} />
                  </div>
                  {view === "chat" && (
                    <div className="composer-wrap">
                      <form
                        className="composer"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void send();
                        }}
                      >
                        <textarea
                          aria-label="Message the team"
                          placeholder="Write a message…"
                          value={draft}
                          disabled={busy}
                          maxLength={10000}
                          onChange={(e) => { setDraft(e.target.value); imageMessageId.current = ""; }}
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
                          rows={2}
                        />
                        <ImagePicker workspaceId={workspaceId} images={draftImages} disabled={busy} onBusy={setUploading}
                          onChange={images => { setDraftImages(images); imageMessageId.current = ""; }} />
                        <div className="composer-bottom">
                          <span>{draftImages.length ? "Images are shared with your team, not AI" : "Shared with your team and AI"}</span>
                          <button
                            className="send-button"
                            type="submit"
                            disabled={busy || uploading || (!draft.trim() && !draftImages.length)}
                            aria-label={
                              busy ? "Sending message" : "Send message"
                            }
                          >
                            {busy ? (
                              <span className="sending-dot" />
                            ) : (
                              <Icon name="arrow" size={18} />
                            )}
                          </button>
                        </div>
                      </form>
                      <div className="composer-hint">
                        Enter to send<span>·</span>Shift + Enter for a new line
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
            {view !== "contracts" && (
              <aside
                className="contracts-panel"
                aria-label="Approved agreements"
              >
                <div className="panel-header">
                  <div>
                    <h2>
                      Agreements
                      <span className="blue-dot" />
                    </h2>
                  </div>
                  <span className="subtle-count">{approved.length}</span>
                </div>
                <div className="contracts-list">
                  {approved.map((c) => (
                    <ContractCard key={c.id} contract={c} compact />
                  ))}
                  {loadingLedger && (
                    <p className="loading-state">Loading agreements…</p>
                  )}
                  {!loadingLedger && approved.length === 0 && (
                    <p className="empty-contracts">
                      No agreements yet.
                    </p>
                  )}
                </div>
              </aside>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function ChairMark() {
  return (
    <svg
      width="22"
      height="24"
      viewBox="0 0 22 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 2h12v10H5V2Zm0 10H2v5h18v-5h-3M5 17v5m12-5v5"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

function EmptyState({
  icon,
  title,
  text,
}: {
  icon: IconName;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon name={icon} size={24} />
      </span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
    </div>
  );
}
