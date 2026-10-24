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
    if (!res.ok) throw new Error(result.error || "Connection request failed.");
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
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="workspace-connections">
      <summary>
        Repository & agents{" "}
        <span>{data?.repository?.name ?? "Set up this workspace"}</span>
      </summary>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="connections-grid">
        <section>
          <h2>Repository</h2>
          <p>
            Connect a repository you administer. Give its token Contents
            read/write access. Each workspace keeps its own connection.
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
              Repository
              <input
                required
                placeholder="owner/repository"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
              />
            </label>
            <label>
              GitHub token
              <input
                required
                type="password"
                autoComplete="off"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
              />
            </label>
            <label>
              Webhook secret
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
              {data?.repository ? "Update credentials" : "Connect repository"}
            </button>
          </form>
          {data?.repository && (
            <p>
              In this repository's GitHub Settings &gt; Webhooks, add{" "}
              <code>{data.webhookUrl}</code>, choose JSON and push events, and
              use the same webhook secret. Saving here does not create the
              GitHub webhook.
            </p>
          )}
        </section>
        <section>
          <h2>Agent access</h2>
          <p>
            Create a separate credential for each coding agent. Credentials
            expire after 30 days and cannot approve changes.
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
              Agent name
              <input
                required
                maxLength={80}
                placeholder="Carter - Codex"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <button disabled={busy}>Create credential</button>
          </form>
          {agentToken && (
            <div className="credential-reveal">
              <p>Save this token now. It will not be shown again.</p>
              <label>
                THECHAIR_AGENT_TOKEN
                <input
                  readOnly
                  value={agentToken}
                  autoComplete="off"
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <p>
                Set it in your MCP or hook environment with THECHAIR_API_URL
                pointing to this site, then restart your agent. The credential
                selects this workspace automatically.
              </p>
              <button onClick={() => setAgentToken("")}>
                I saved it - hide token
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
                      ? "Revoked"
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
                    Revoke
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
