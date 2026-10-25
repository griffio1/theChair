// Demo driver for "start demo". Each step is a subcommand so Claude can narrate between them:
//   check | hook | push | wait-card <sinceIso> | wait-approve <conflictId> | reset
// Reads web/.env.local (Supabase service key + GitHub token). Prints short, presentable lines.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKSPACE = "Test67";
const FILE = "demo/web/Login.tsx";

const env: Record<string, string> = {};
for (const line of readFileSync(join(ROOT, "web/.env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "GITHUB_TOKEN"])
  if (!env[key]) fail(`${key} missing from web/.env.local`);
const APP = env.THECHAIR_PUBLIC_URL || "https://the-chair-peach.vercel.app";

function fail(message: string): never {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}
const ok = (message: string) => console.log(`OK    ${message}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function db<T>(path: string): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) fail(`Supabase ${path.split("?")[0]} -> ${res.status}`);
  return (await res.json()) as T;
}

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!res.ok) fail(`GitHub ${init.method ?? "GET"} ${path} -> ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

async function workspace() {
  const [ws] = await db<{ id: string }[]>(`chair_workspaces?select=id&name=eq.${WORKSPACE}`);
  if (!ws) fail(`workspace ${WORKSPACE} not found`);
  const [conn] = await db<{ repository: string }[]>(
    `chair_repository_connections?select=repository&workspace_id=eq.${ws.id}`,
  );
  if (!conn) fail(`${WORKSPACE} has no connected repository`);
  return { id: ws.id, repo: conn.repository };
}

async function mainFile(repo: string, ref = "main") {
  const f = await gh<{ content: string; sha: string }>(`/repos/${repo}/contents/${FILE}?ref=${ref}`);
  return { text: Buffer.from(f.content, "base64").toString("utf8"), sha: f.sha };
}

async function check() {
  const res = await fetch(APP, { redirect: "manual" }).catch(() => undefined);
  if (!res || res.status >= 500) fail(`${APP} is not responding`);
  ok(`app is up: ${APP}`);
  const ws = await workspace();
  ok(`workspace ${WORKSPACE} is connected to ${ws.repo}`);
  const [login] = await db<{ version: number; response: { name: string }[] }[]>(
    `contracts?select=version,response&workspace_id=eq.${ws.id}&id=eq.auth-login&status=eq.approved&order=version.desc&limit=1`,
  );
  if (!login) fail("auth-login has no approved contract in Test67");
  ok(`contract auth-login v${login.version} approved: response { ${login.response.map((f) => f.name).join(", ")} }`);
  const { text } = await mainFile(ws.repo);
  if (!text.includes("data.userId")) fail(`${FILE} on main does not read data.userId; reset it first`);
  ok(`${FILE} on main reads data.userId (matches the contract)`);
  const stale = await gh<{ ref: string }[]>(`/repos/${ws.repo}/git/matching-refs/heads/agent/codex/live-demo-`);
  if (stale.length) console.log(`NOTE  ${stale.length} old demo branch(es) on GitHub; "reset" removes them`);
}

async function push() {
  const ws = await workspace();
  const since = new Date().toISOString();
  const stamp = since.slice(11, 19).replace(/:/g, "");
  const branch = `agent/codex/live-demo-${stamp}`;
  const main = await gh<{ object: { sha: string } }>(`/repos/${ws.repo}/git/ref/heads/main`);
  await gh(`/repos/${ws.repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: main.object.sha }),
  });
  const file = await mainFile(ws.repo, branch);
  const broken = file.text.replace("data.userId", "data.user_id");
  if (broken === file.text) fail(`${FILE} has no data.userId to break`);
  const commit = await gh<{ commit: { sha: string } }>(`/repos/${ws.repo}/contents/${FILE}`, {
    method: "PUT",
    body: JSON.stringify({
      message: "Read user_id from login response (per old notes)",
      content: Buffer.from(broken).toString("base64"),
      sha: file.sha,
      branch,
    }),
  });
  const line = broken.split("\n").findIndex((l) => l.includes("data.user_id")) + 1;
  ok(`pushed ${branch} @ ${commit.commit.sha.slice(0, 7)}: ${FILE}:${line} now reads data.user_id`);
  console.log(`SINCE ${since}`);
}

async function waitCard(since: string) {
  if (!since) fail("usage: wait-card <sinceIso>");
  const ws = await workspace();
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const [card] = await db<
      { id: string; severity: string; summary: string; suggested_fix: string; evidence: { file: string; line: number; snippet: string }[] }[]
    >(
      `conflicts?select=id,severity,summary,suggested_fix,evidence&workspace_id=eq.${ws.id}&detected_by=eq.webhook&created_at=gt.${encodeURIComponent(since)}&order=created_at.desc&limit=1`,
    );
    if (card) {
      const where = card.evidence?.[0];
      ok(`red card after ${((Date.now() - started) / 1000).toFixed(1)}s (${card.severity})`);
      console.log(`CARD  ${card.summary}`);
      if (where) console.log(`AT    ${where.file}:${where.line}  ${where.snippet.trim()}`);
      if (card.suggested_fix) console.log(`FIX   ${card.suggested_fix}`);
      console.log(`ID    ${card.id}`);
      return;
    }
    await sleep(1500);
  }
  fail("no card within 60s. Check the GitHub webhook deliveries and Vercel logs");
}

async function waitApprove(id: string) {
  if (!id) fail("usage: wait-approve <conflictId>");
  const started = Date.now();
  while (Date.now() - started < 10 * 60_000) {
    const [c] = await db<{ status: string; created_at: string }[]>(`conflicts?select=status,created_at&id=eq.${id}`);
    if (c?.status === "approved") {
      ok("card approved and green");
      // Approve re-commits contracts/<id>.json and AGENTS.md, but only files whose content changed.
      const ws = await workspace();
      for (let tries = 0; tries < 8; tries++) {
        const commits = await gh<{ sha: string; commit: { message: string } }[]>(
          `/repos/${ws.repo}/commits?sha=main&since=${encodeURIComponent(c.created_at)}&per_page=5`,
        );
        const published = commits.filter((x) => /^(contracts:|AGENTS\.md:)/.test(x.commit.message));
        if (published.length) {
          for (const x of published.reverse()) ok(`committed ${x.sha.slice(0, 7)} "${x.commit.message.split("\n")[0]}"`);
          return;
        }
        await sleep(2000);
      }
      console.log("NOTE  no new commit: the repo already had the current contract");
      return;
    }
    await sleep(2000);
  }
  fail("not approved within 10 minutes");
}

// Hands the real Claude Code hook the exact breaking edit, without writing anything.
async function hook() {
  const input = {
    tool_name: "Edit",
    cwd: ROOT,
    tool_input: { file_path: join(ROOT, FILE), old_string: "data.userId", new_string: "data.user_id" },
  };
  const r = spawnSync("npx", ["tsx", join(ROOT, "hooks/preflight-hook.ts")], {
    cwd: ROOT,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
  });
  if (r.status !== 2) fail(`hook did not block (exit ${r.status}): ${r.stderr.trim()}`);
  ok("hook blocked the edit (exit 2). Its message to the agent:");
  for (const line of r.stderr.trim().split("\n").filter(Boolean)) console.log(`HOOK  ${line}`);
}

async function reset() {
  const ws = await workspace();
  const refs = await gh<{ ref: string }[]>(`/repos/${ws.repo}/git/matching-refs/heads/agent/codex/live-demo-`);
  for (const r of refs) await gh(`/repos/${ws.repo}/git/${r.ref}`, { method: "DELETE" });
  ok(`removed ${refs.length} demo branch(es); main is untouched`);
}

const [cmd, arg] = process.argv.slice(2);
const steps: Record<string, () => Promise<void>> = {
  check,
  hook,
  push,
  "wait-card": () => waitCard(arg),
  "wait-approve": () => waitApprove(arg),
  reset,
};
if (!steps[cmd]) fail(`unknown step "${cmd}". Use: ${Object.keys(steps).join(" | ")}`);
steps[cmd]().catch((e) => fail(String(e)));
