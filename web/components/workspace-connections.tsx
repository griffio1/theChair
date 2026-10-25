"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Credential = {
  id: string;
  label: string;
  expiresAt: string;
  revokedAt: string | null;
};
type Connections = {
  repository: { name: string } | null;
  credentials: Credential[];
  webhookUrl: string;
};
export default function WorkspaceConnections({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [data, setData] = useState<Connections | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [repo, setRepo] = useState(""),
    [githubToken, setGithubToken] = useState(""),
    [secret, setSecret] = useState(""),
    [label, setLabel] = useState("");
  const [agentToken, setAgentToken] = useState("");
  const base = `/api/workspaces/${workspaceId}/integrations`;
  async function request(path: string, body?: unknown) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Sign in again.");
    const res = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Couldn’t connect. Try again.");
    return result;
  }
  async function load() {
    setData(await request(""));
  }
  useEffect(() => {
    let active = true;
    request("")
      .then((r) => {
        if (active) {
          setData(r);
          setRepo(r.repository?.name ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t connect. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="workspace-connections">
      <summary>
        Connections{" "}
        <span>{data ? data.repository?.name ?? "Not connected" : error ? "Unavailable" : "Loading…"}</span>
      </summary>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="connections-grid">
        <section>
          <h2>GitHub</h2>
          <p>
            You need admin access and a GitHub access token with Contents read/write access.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await request("/repository", {
                  repository: repo,
                  token: githubToken,
                  webhookSecret: secret,
                });
                setGithubToken("");
                setSecret("");
              });
            }}
          >
            <label>
              GitHub project
              <input
                required
                placeholder="owner/repository"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
              />
            </label>
            <label>
              GitHub access token
              <input
                required
                type="password"
                autoComplete="off"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
              />
            </label>
            <label>
              Shared secret (32+ characters)
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={32}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {data?.repository ? "Save" : "Connect"}
            </button>
          </form>
          {data?.repository && (
            <>
            <p>Finish setup in GitHub to check code updates.</p>
            <details className="connection-help">
              <summary>GitHub setup</summary>
              <p>In GitHub: Settings → Webhooks → Add webhook.</p>
              <p>URL: <code>{data.webhookUrl}</code></p>
              <p>Choose JSON, Push events, and the same secret.</p>
            </details>
            </>
          )}
        </section>
        <section>
          <h2>AI tools</h2>
          <p>
            Keys expire in 30 days. AI tools cannot approve changes.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                const r = await request("/agents", { label });
                setAgentToken(r.token);
                setLabel("");
              });
            }}
          >
            <label>
              Name
              <input
                required
                maxLength={80}
                placeholder="Codex"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <button disabled={busy}>Create key</button>
          </form>
          {agentToken && (
            <div className="credential-reveal">
              <p>Copy this key. It won’t be shown again.</p>
              <label>
                Access key
                <input
                  readOnly
                  value={agentToken}
                  autoComplete="off"
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <details className="connection-help">
                <summary>Setup</summary>
                <p>In your tool’s settings, set <code>THECHAIR_AGENT_TOKEN</code> to this key and <code>THECHAIR_API_URL</code> to this site. Restart the tool.</p>
              </details>
              <button onClick={() => setAgentToken("")}>
                Hide key
              </button>
            </div>
          )}
          <ul>
            {data?.credentials.map((c) => (
              <li key={c.id}>
                <span>
                  <strong>{c.label}</strong>
                  <small>
                    {c.revokedAt
                      ? "Disabled"
                      : `Expires ${new Date(c.expiresAt).toLocaleDateString()}`}
                  </small>
                </span>
                {!c.revokedAt && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await request(`/agents/${c.id}/revoke`, {});
                        setAgentToken("");
                      })
                    }
                  >
                    Disable key
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}
