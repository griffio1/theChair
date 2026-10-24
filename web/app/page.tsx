"use client";
// Dashboard (M6) starting point: main chat thread on the left (messages + conflict and contract cards
// with Approve buttons), contracts on the right. Builder B owns this file; restyle freely.

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Row = Record<string, any>;

export default function Dashboard() {
  const [messages, setMessages] = useState<Row[]>([]);
  const [conflicts, setConflicts] = useState<Record<string, Row>>({});
  const [contracts, setContracts] = useState<Row[]>([]);
  const [draft, setDraft] = useState("");
  const [me, setMe] = useState("teammate");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  async function loadContracts() {
    const { data } = await supabase.from("contracts").select("*").order("id").order("version", { ascending: false });
    setContracts(data ?? []);
  }

  useEffect(() => {
    try {
      setMe(localStorage.getItem("agentsync:name") ?? "teammate");
    } catch {}
    (async () => {
      const { data: m } = await supabase.from("messages").select("*").order("created_at").limit(200);
      setMessages(m ?? []);
      const { data: c } = await supabase.from("conflicts").select("*");
      setConflicts(Object.fromEntries((c ?? []).map((x) => [x.id, x])));
      await loadContracts();
    })();

    const ch = supabase
      .channel("agentsync")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) =>
        setMessages((prev) => (prev.some((x) => x.id === p.new.id) ? prev : [...prev, p.new])),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "conflicts" }, (p) =>
        setConflicts((prev) => ({ ...prev, [(p.new as Row).id]: p.new as Row })),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "contracts" }, () => loadContracts())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages.length]);

  async function send() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    const body = draft;
    setDraft("");
    try {
      await fetch("/api/chat", { method: "POST", body: JSON.stringify({ author: me, body }) });
    } finally {
      setBusy(false);
    }
  }

  async function approveConflict(id: string) {
    await fetch(`/api/conflicts/${id}/approve`, { method: "POST", body: JSON.stringify({ approvedBy: me }) });
  }
  async function approveContract(ref: string) {
    const [id, version] = ref.split("@");
    await fetch(`/api/contracts/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ version: Number(version), approvedBy: me }),
    });
  }

  const approved = contracts.filter((c) => c.status === "approved");
  const openCount = Object.values(conflicts).filter((c) => c.status === "open").length;
  const caught = Object.values(conflicts).filter((c) => c.severity === "block").length;

  return (
    <main style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", height: "100vh" }}>
      <section style={{ display: "flex", flexDirection: "column", borderRight: "1px solid #262a33", minWidth: 0 }}>
        <header style={{ padding: 16, borderBottom: "1px solid #262a33", display: "flex", gap: 16, alignItems: "center" }}>
          <strong>AgentSync</strong>
          <span style={{ opacity: 0.7 }}>{caught} caught before merge</span>
          <span style={{ opacity: 0.7 }}>{openCount} open</span>
          <input
            value={me}
            onChange={(e) => {
              setMe(e.target.value);
              try {
                localStorage.setItem("agentsync:name", e.target.value);
              } catch {}
            }}
            style={{ marginLeft: "auto", width: 120 }}
            aria-label="Your name"
          />
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m) => {
            if (m.kind === "conflict") {
              const c = conflicts[m.ref_id];
              const open = c?.status === "open";
              return (
                <div key={m.id} style={card(open ? (c?.severity === "block" ? "#5c1f24" : "#4a3b14") : "#173d2a")}>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {c?.detected_by ?? "check"} · {c?.agent ?? "agent"} for {c?.developer ?? "?"} · {c?.kind}
                  </div>
                  <div style={{ margin: "6px 0" }}>{m.body}</div>
                  {c?.evidence?.[0] && (
                    <code style={{ fontSize: 12, opacity: 0.85 }}>
                      {c.evidence[0].file}:{c.evidence[0].line} {c.evidence[0].snippet}
                    </code>
                  )}
                  {c?.suggested_fix && <div style={{ marginTop: 6, fontSize: 13 }}>Fix: {c.suggested_fix}</div>}
                  {open && (
                    <button onClick={() => approveConflict(c.id)} style={{ marginTop: 8 }}>
                      Approve fix
                    </button>
                  )}
                </div>
              );
            }
            if (m.kind === "contract_proposal") {
              const [id, v] = String(m.ref_id).split("@");
              const c = contracts.find((x) => x.id === id && String(x.version) === v);
              return (
                <div key={m.id} style={card("#1d2b4a")}>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    Contract proposal · {id} v{v} · {c?.status ?? "proposed"}
                  </div>
                  {c && (
                    <code style={{ display: "block", margin: "6px 0", fontSize: 12 }}>
                      {c.method} {c.path} → {"{ "}
                      {c.response.map((f: Row) => `${f.name}: ${f.type}`).join(", ")}
                      {" }"}
                    </code>
                  )}
                  <div>{m.body}</div>
                  {c?.status === "proposed" && (
                    <button onClick={() => approveContract(m.ref_id)} style={{ marginTop: 8 }}>
                      Approve contract
                    </button>
                  )}
                </div>
              );
            }
            return (
              <div key={m.id} style={{ opacity: m.author_type === "system" ? 0.7 : 1 }}>
                <strong style={{ fontSize: 13 }}>{m.author_name}</strong>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid #262a33" }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Plan with the team, e.g. 'login returns userId and token'"
            style={{ flex: 1, padding: 10 }}
          />
          <button disabled={busy}>{busy ? "…" : "Send"}</button>
        </form>
      </section>

      <aside style={{ padding: 16, overflowY: "auto" }}>
        <h3 style={{ marginTop: 0 }}>Contracts</h3>
        {approved.length === 0 && <p style={{ opacity: 0.6 }}>None approved yet.</p>}
        {[...new Map(approved.map((c) => [c.id, c])).values()].map((c) => (
          <div key={c.id} style={card("#1a1d24")}>
            <strong>
              {c.method} {c.path}
            </strong>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {c.id} v{c.version}
            </div>
            <div style={{ fontSize: 13, marginTop: 6 }}>
              → {c.response.map((f: Row) => f.name).join(", ")}
            </div>
          </div>
        ))}
      </aside>
    </main>
  );
}

function card(bg: string): React.CSSProperties {
  return { background: bg, borderRadius: 8, padding: 12 };
}
