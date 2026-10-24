// GitHub REST helpers: read files, list changed files, commit contract + AGENTS.md.

const API = "https://api.github.com";

function headers() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN must be set");
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

function repo(): string {
  const r = process.env.GITHUB_REPO;
  if (!r) throw new Error("GITHUB_REPO must be set (owner/repo)");
  return r;
}

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`GitHub ${init?.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Returns file text and its blob sha, or undefined if it doesn't exist. */
export async function readFile(path: string, ref?: string): Promise<{ text: string; sha: string } | undefined> {
  try {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const f = await gh<{ content: string; sha: string }>(`/repos/${repo()}/contents/${path}${q}`);
    return { text: Buffer.from(f.content, "base64").toString("utf8"), sha: f.sha };
  } catch (e) {
    if (String(e).includes("-> 404")) return undefined;
    throw e;
  }
}

/** Files changed between two commits (status other than "removed"). */
export async function changedFiles(before: string, after: string): Promise<string[]> {
  if (/^0+$/.test(before)) {
    const c = await gh<{ files: { filename: string; status: string }[] }>(`/repos/${repo()}/commits/${after}`);
    return c.files.filter((f) => f.status !== "removed").map((f) => f.filename);
  }
  const cmp = await gh<{ files: { filename: string; status: string }[] }>(
    `/repos/${repo()}/compare/${before}...${after}`,
  );
  return cmp.files.filter((f) => f.status !== "removed").map((f) => f.filename);
}

/** Create or update one file in a single commit on the default branch. */
export async function writeFile(path: string, text: string, message: string, branch?: string): Promise<string> {
  const existing = await readFile(path, branch);
  const res = await gh<{ commit: { sha: string } }>(`/repos/${repo()}/contents/${path}`, {
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
