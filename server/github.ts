// GitHub REST helpers: read files, list changed files, commit contract + AGENTS.md.

const API = "https://api.github.com";

import { select } from "./db";
import { currentWorkspace } from "./workspace-context";

export interface RepositoryConnection {
  workspace_id: string;
  repository_id: number;
  repository: string;
  token: string;
  webhook_secret: string;
  connected_by: string;
  connected_at: string;
}
export class RepositoryNotConnectedError extends Error {}
export async function repositoryConnection(): Promise<RepositoryConnection> {
  const [connection] = await select<RepositoryConnection>(
    "chair_repository_connections",
    `workspace_id=eq.${currentWorkspace()}`,
  );
  if (!connection)
    throw new RepositoryNotConnectedError(
      "Connect this workspace's repository before approving or checking code.",
    );
  return connection;
}
async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const connection = await repositoryConnection();
  const res = await fetch(`${API}/repos/${connection.repository}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: {
      authorization: `Bearer ${connection.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok)
    throw new Error(`GitHub ${init?.method ?? "GET"} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** Returns file text and its blob sha, or undefined if it doesn't exist. */
export async function readFile(
  path: string,
  ref?: string,
): Promise<{ text: string; sha: string } | undefined> {
  try {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const f = await gh<{ content: string; sha: string }>(
      `/contents/${path}${q}`,
    );
    return {
      text: Buffer.from(f.content, "base64").toString("utf8"),
      sha: f.sha,
    };
  } catch (e) {
    if (String(e).includes("-> 404")) return undefined;
    throw e;
  }
}

/** Files changed between two commits (status other than "removed"). */
export async function changedFiles(
  before: string,
  after: string,
): Promise<string[]> {
  if (/^0+$/.test(before)) {
    const c = await gh<{ files: { filename: string; status: string }[] }>(
      `/commits/${after}`,
    );
    return c.files.filter((f) => f.status !== "removed").map((f) => f.filename);
  }
  const cmp = await gh<{ files: { filename: string; status: string }[] }>(
    `/compare/${before}...${after}`,
  );
  return cmp.files.filter((f) => f.status !== "removed").map((f) => f.filename);
}

/** Create or update one file in a single commit on the default branch. */
export async function writeFile(
  path: string,
  text: string,
  message: string,
  branch?: string,
): Promise<string> {
  const existing = await readFile(path, branch);
  const res = await gh<{ commit: { sha: string } }>(`/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(text, "utf8").toString("base64"),
      ...(existing ? { sha: existing.sha } : {}),
      ...(branch ? { branch } : {}),
    }),
  });
  return res.commit.sha;
}
