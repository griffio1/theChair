"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

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
        <span className="field-label">Request</span>
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
        <span className="field-label">Response</span>
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
          Owned by {contract.owner}
        </div>
      )}
    </article>
  );
}

export default function Dashboard() {
  const [messages, setMessages] = useState<Row[]>([]);
  const [conflicts, setConflicts] = useState<Record<string, Row>>({});
  const [contracts, setContracts] = useState<Row[]>([]);
  const [draft, setDraft] = useState("");
  const [me, setMe] = useState("teammate");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [connection, setConnection] = useState("Connecting");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let preferred: "light" | "dark" = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches
      ? "dark"
      : "light";
    try {
      const saved = localStorage.getItem("thechair:theme");
      if (saved === "light" || saved === "dark") preferred = saved;
    } catch {}
    document.documentElement.dataset.theme = preferred;
    setTheme(preferred);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("thechair:theme", next);
    } catch {}
  }

  function updateName(value: string) {
    setMe(value);
    try {
      localStorage.setItem("thechair:name", value);
    } catch {}
  }

  async function loadContracts() {
    const { data, error } = await supabase
      .from("contracts")
      .select("*")
      .order("id")
      .order("version", { ascending: false });
    if (error) throw error;
    setContracts(data ?? []);
  }

  useEffect(() => {
    try {
      setMe(localStorage.getItem("thechair:name") ?? "teammate");
    } catch {}
    async function load() {
      try {
        const { data: m, error: messageError } = await supabase
          .from("messages")
          .select("*")
          .order("created_at")
          .limit(200);
        if (messageError) throw messageError;
        setMessages(m ?? []);
        const { data: c, error: conflictError } = await supabase
          .from("conflicts")
          .select("*");
        if (conflictError) throw conflictError;
        setConflicts(Object.fromEntries((c ?? []).map((x) => [x.id, x])));
        await loadContracts();
      } catch {
        setError("Couldn’t load the workspace. Refresh to try again.");
      } finally {
        setLoading(false);
      }
    }
    void load();
    const ch = supabase
      .channel("thechair")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (p) =>
          setMessages((prev) =>
            prev.some((x) => x.id === p.new.id) ? prev : [...prev, p.new],
          ),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conflicts" },
        (p) =>
          setConflicts((prev) => {
            const next = { ...prev };
            if (p.eventType === "DELETE") delete next[p.old.id];
            else next[p.new.id] = p.new;
            return next;
          }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contracts" },
        () => {
          void loadContracts().catch(() =>
            setError("Couldn’t refresh contracts. Refresh to try again."),
          );
        },
      )
      .subscribe((status) =>
        setConnection(
          status === "SUBSCRIBED"
            ? "Live"
            : status === "CHANNEL_ERROR" ||
                status === "TIMED_OUT" ||
                status === "CLOSED"
              ? "Reconnecting"
              : "Connecting",
        ),
      );
    return () => {
      void supabase.removeChannel(ch);
    };
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, view]);

  async function send() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError("");
    const body = draft;
    setDraft("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author: me, body }),
      });
      if (!response.ok) throw new Error("Send failed");
    } catch {
      setDraft((current) => current || body);
      setError("Your message couldn’t be sent. Please try again.");
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
    setPending(key);
    setError("");
    try {
      const response = await fetch(
        `/api/${kind === "conflict" ? "conflicts" : "contracts"}/${encodeURIComponent(id)}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            kind === "conflict"
              ? { approvedBy: me }
              : { version, approvedBy: me },
          ),
        },
      );
      if (!response.ok) throw new Error("Approval failed");
      if (kind === "contract") await loadContracts();
      else {
        const { data, error } = await supabase.from("conflicts").select("*");
        if (error) throw error;
        setConflicts(Object.fromEntries((data ?? []).map((c) => [c.id, c])));
      }
    } catch {
      setError(
        "Couldn’t confirm the approval. Refresh to check its status before trying again.",
      );
    } finally {
      setPending(null);
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
          className={`event-card ${open ? "conflict-card" : "resolved-card"}`}
        >
          <div className="event-heading">
            <span className="event-icon">
              <Icon name={open ? "conflicts" : "check"} size={16} />
            </span>
            <strong>
              {open
                ? "Contract conflict detected"
                : c
                  ? "Conflict resolved"
                  : "Contract check"}
            </strong>
            <span className={`badge ${open ? "badge-warn" : "badge-neutral"}`}>
              {open ? "Needs review" : (c?.status ?? "Recorded")}
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
          <div className="event-footer">
            <span>
              {c?.agent ?? "Agent"}
              {c?.developer ? ` · ${c.developer}` : ""}
              {c?.detected_by ? ` · ${c.detected_by}` : ""}
            </span>
            {open && (
              <button
                className="button-dark button-small"
                disabled={pending !== null}
                onClick={() => void approve("conflict", c.id)}
              >
                {pending === `conflict:${c.id}` ? "Approving…" : "Approve fix"}
                <Icon name="chevron" size={13} />
              </button>
            )}
          </div>
        </article>
      );
    }
    if (m.kind === "contract_proposal") {
      const [id, version] = String(m.ref_id).split("@");
      const c = contracts.find(
        (x) => x.id === id && String(x.version) === version,
      );
      return (
        <article key={m.id} className="event-card proposal-card">
          <div className="event-heading">
            <span className="event-icon">
              <Icon name="contracts" size={16} />
            </span>
            <strong>A new agreement</strong>
            <span className="badge badge-neutral">
              {c?.status ?? "Proposed"}
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
          <div className="event-footer">
            <span>{id}</span>
            {c?.status === "proposed" && (
              <button
                className="button-dark button-small"
                disabled={pending !== null}
                onClick={() => void approve("contract", id, Number(version))}
              >
                {pending === `contract:${id}`
                  ? "Approving…"
                  : "Approve contract"}
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
        className={`message ${system ? "system-message" : ""}`}
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
          <div className="message-body">{m.body}</div>
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
          <span className="project-icon">T</span>
          <div>
            <strong>theChair</strong>
            <span>Team workspace</span>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {(
            [
              { key: "chat", label: "Main chat", icon: "chat" },
              { key: "conflicts", label: "Conflicts", icon: "conflicts" },
              { key: "contracts", label: "Contracts", icon: "contracts" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              className={`nav-item ${view === item.key ? "active" : ""}`}
              onClick={() => setView(item.key)}
              aria-current={view === item.key ? "page" : undefined}
              title={item.label}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.key === "conflicts" && openCount > 0 && (
                <span className="nav-count">{openCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-symbol">↗</span>
          <strong>
            Shared intent.
            <br />
            Better together.
          </strong>
          <p>One place for your team and agents to agree.</p>
        </div>
        <div className="profile">
          <span className="avatar profile-avatar">
            {me.slice(0, 1).toUpperCase() || "?"}
          </span>
          <label>
            <span>YOUR NAME</span>
            <input
              aria-label="Your name"
              value={me}
              onChange={(e) => updateName(e.target.value)}
            />
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
                ? "Main chat"
                : view === "conflicts"
                  ? "Conflicts"
                  : "Contracts"}
            </strong>
          </div>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            <Icon name={theme === "light" ? "moon" : "sun"} size={16} />
          </button>
          <label className="compact-profile">
            <span>You</span>
            <input
              aria-label="Your name"
              value={me}
              onChange={(e) => updateName(e.target.value)}
            />
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
              <div className="eyebrow">LESS FRICTION. MORE BUILDING.</div>
              <h1>
                Great minds.
                <br className="mobile-break" /> Same page<span>.</span>
              </h1>
              <p>
                A shared space for your team, your agents, and the decisions
                that connect them.
              </p>
            </div>
            <div className="overview-art" aria-hidden="true">
              <span className="orbit orbit-one" />
              <span className="orbit orbit-two" />
              <span className="orbit-center">
                <ChairMark />
              </span>
              <span className="orbit-node node-one" />
              <span className="orbit-node node-two" />
            </div>
          </section>
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
                  {loading ? "—" : String(approved.length).padStart(2, "0")}
                </strong>
                <span>Shared contracts</span>
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
                  {loading ? "—" : String(openCount).padStart(2, "0")}
                </strong>
                <span>Needs attention</span>
              </span>
              <Icon name="chevron" size={14} />
            </button>
            <div className="metric">
              <span className="metric-icon metric-green">
                <Icon name="check" />
              </span>
              <span>
                <strong>
                  {loading ? "—" : String(caught).padStart(2, "0")}
                </strong>
                <span>Caught before merge</span>
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
          <div
            className={`content-grid ${view === "contracts" ? "contracts-view" : ""}`}
          >
            <section
              className="main-panel"
              aria-label={
                view === "chat"
                  ? "Main chat"
                  : view === "conflicts"
                    ? "Conflict activity"
                    : "Contract ledger"
              }
            >
              <div className="panel-header">
                <div>
                  <h2>
                    {view === "chat"
                      ? "The conversation"
                      : view === "conflicts"
                        ? "Conflict activity"
                        : "Contract ledger"}
                  </h2>
                  <p>
                    {view === "chat"
                      ? "Where everyone gets on the same page."
                      : view === "conflicts"
                        ? "Catch the mismatch. Keep the momentum."
                        : "The agreements your team builds on."}
                  </p>
                </div>
                <span className="panel-tag">
                  {view === "chat"
                    ? "Main chat"
                    : view === "conflicts"
                      ? `${openCount} open`
                      : `${approved.length} approved`}
                </span>
              </div>
              {view === "contracts" ? (
                <div className="ledger-grid">
                  {approved.map((c) => (
                    <ContractCard key={c.id} contract={c} />
                  ))}
                  {!loading && approved.length === 0 && (
                    <EmptyState
                      icon="contracts"
                      title="Your first agreement starts here"
                      text="Propose a contract in the main chat. Approved contracts will appear here."
                    />
                  )}
                  {loading && (
                    <p className="loading-state" role="status">
                      Loading contracts…
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
                    {loading ? (
                      <p className="loading-state" role="status">
                        Loading your workspace…
                      </p>
                    ) : visibleMessages.length === 0 ? (
                      <EmptyState
                        icon={view === "chat" ? "chat" : "check"}
                        title={
                          view === "chat"
                            ? "Good things start with a conversation"
                            : "A little peace of mind"
                        }
                        text={
                          view === "chat"
                            ? "Share a plan or propose an API contract. Your agents will build with the same understanding."
                            : "No conflict activity yet. Contract checks will show up here when there’s something to review."
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
                          placeholder="Share a plan. Ask a question. Make an agreement."
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
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
                        <div className="composer-bottom">
                          <span>Visible to your team & agents</span>
                          <button
                            className="send-button"
                            type="submit"
                            disabled={busy || !draft.trim()}
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
                aria-label="Approved contracts"
              >
                <div className="panel-header">
                  <div>
                    <h2>
                      Source of truth
                      <span className="blue-dot" />
                    </h2>
                    <p>Agreed on. Built against.</p>
                  </div>
                  <span className="subtle-count">{approved.length}</span>
                </div>
                <div className="contracts-list">
                  {approved.map((c) => (
                    <ContractCard key={c.id} contract={c} compact />
                  ))}
                  {loading && (
                    <p className="loading-state">Loading contracts…</p>
                  )}
                  {!loading && approved.length === 0 && (
                    <p className="empty-contracts">
                      Your approved API contracts will appear here.
                    </p>
                  )}
                </div>
                <div className="ledger-note">
                  <Icon name="check" size={16} />
                  <p>
                    Your agents check these agreements before they write code.
                  </p>
                </div>
              </aside>
            )}
          </div>
          <footer className="workspace-footer">
            <span>theChair — Git merges code. We merge intent.</span>
            <span>
              Made for building together<span className="footer-spark">✳</span>
            </span>
          </footer>
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
      <p>{text}</p>
    </div>
  );
}
