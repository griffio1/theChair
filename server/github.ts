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
export class GitHubError extends Error {
  constructor(public readonly status: number) { super(`GitHub request failed (HTTP ${status})`); }
}
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
  init?.signal?.throwIfAborted();
  const res = await fetch(`${API}/repos/${connection.repository}${path}`, {
    ...init,
    cache: "no-store",
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: {
      authorization: `Bearer ${connection.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new GitHubError(res.status);
  return (await res.json()) as T;
}

/** Returns file text and its blob sha, or undefined if it doesn't exist. */
export async function readFile(
  path: string,
  ref?: string,
  signal?: AbortSignal,
): Promise<{ text: string; sha: string } | undefined> {
  try {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const f = await gh<{ content: string; sha: string }>(
      `/contents/${path.split("/").map(encodeURIComponent).join("/")}${q}`, { signal },
    );
    return {
      text: Buffer.from(f.content, "base64").toString("utf8"),
      sha: f.sha,
    };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return undefined;
    throw e;
  }
}

/** Files changed between two commits (status other than "removed"). */
export async function changedFiles(
  before: string,
  after: string,
): Promise<string[]> {
  if (/^0+$/.test(before)) {
    // A new branch may contain many unpublished commits. Looking at only its
    // last commit misses earlier changes, so inspect the complete snapshot.
    const commit = await gh<{ tree: { sha: string } }>(`/git/commits/${after}`);
    const tree = await gh<{ truncated: boolean; tree: { path: string; type: string }[] }>(
      `/git/trees/${commit.tree.sha}?recursive=1`,
    );
    if (tree.truncated) throw new Error("This branch is too large for a complete code check.");
    return tree.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
  }
  const cmp = await gh<{ files: { filename: string; status: string }[] }>(
    `/compare/${before}...${after}`,
  );
  // GitHub caps a comparison's file list at 300, including paginated results.
  if (cmp.files.length >= 300) throw new Error("This update is too large for a complete code check.");
  return cmp.files.filter((f) => f.status !== "removed").map((f) => f.filename);
}

export interface PublicationCandidate { branch: string; baseSha: string; sha: string }

/** Publish both agreement files together, without replacing concurrent commits. */
export async function publishFilesAtomically(options: {
  message: string;
  pending?: PublicationCandidate;
  files: (head: string, signal: AbortSignal) => Promise<{ path: string; content: string }[]>;
  recordCandidate: (candidate: PublicationCandidate) => Promise<void>;
  discardCandidate: (sha: string) => Promise<void>;
}): Promise<string> {
  const signal = AbortSignal.timeout(45000);
  const repository = await gh<{ default_branch: string }>("", { signal });
  const branch = repository.default_branch;
  const encoded = branch.split("/").map(encodeURIComponent).join("/");
  const head = async () => (await gh<{ object: { sha: string } }>(`/git/ref/heads/${encoded}`, { signal })).object.sha;
  const move = async (sha: string) => gh(`/git/refs/heads/${encoded}`, {
    method: "PATCH", signal, body: JSON.stringify({ sha, force: false }),
  });

  if (options.pending) {
    const pending = options.pending;
    if (pending.branch !== branch) throw new Error("The default branch changed during approval. Review the unfinished approval before retrying.");
    const current = await head();
    if (current === pending.sha) return pending.sha;
    const comparison = await gh<{ status: string }>(`/compare/${pending.sha}...${current}`, { signal });
    if (comparison.status === "ahead" || comparison.status === "identical") return pending.sha;
    if (current !== pending.baseSha)
      throw new Error("The branch changed during an unfinished approval. Review its saved commit before retrying.");
    await options.recordCandidate(pending); // Re-check and renew the current worker's lease.
    await move(pending.sha);
    return pending.sha;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const baseSha = await head();
    const commit = await gh<{ tree: { sha: string } }>(`/git/commits/${baseSha}`, { signal });
    const files = await options.files(baseSha, signal);
    if (files.length !== 2 || new Set(files.map((file) => file.path)).size !== 2)
      throw new Error("An approval must publish both agreement files together.");
    const tree = await gh<{ sha: string }>("/git/trees", { method: "POST", signal, body: JSON.stringify({
      base_tree: commit.tree.sha,
      tree: files.map((file) => ({ ...file, mode: "100644", type: "blob" })),
    }) });
    const created = await gh<{ sha: string }>("/git/commits", { method: "POST", signal, body: JSON.stringify({
      message: options.message, tree: tree.sha, parents: [baseSha],
    }) });
    // Persist before the only externally visible mutation. A timeout after this
    // point can be reconciled against branch ancestry without duplicating a commit.
    await options.recordCandidate({ branch, baseSha, sha: created.sha });
    try {
      await move(created.sha);
      return created.sha;
    } catch (error) {
      // Only a definite ref rejection is safe to rebase. Network/timeouts may
      // mean GitHub accepted the update: leave the saved candidate for recovery.
      if (!(error instanceof GitHubError) || ![409, 422].includes(error.status)) throw error;
      await options.discardCandidate(created.sha);
      if (attempt === 2) throw new Error("The branch kept changing. Retry this approval after code updates finish.");
    }
  }
  throw new Error("Approval could not be published.");
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
