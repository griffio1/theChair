import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { changedFiles, publishFilesAtomically, type PublicationCandidate } from "../server/github";
import { inWorkspace } from "../server/workspace-context";

const workspace = "10000000-0000-4000-8000-000000000001";
const base = "a".repeat(40), concurrent = "b".repeat(40), candidate = "c".repeat(40);
function fixture(t: TestContext, api: (path: string, method: string, body: any) => Response | Promise<Response>) {
  const previous = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY };
  process.env.SUPABASE_URL = "https://ledger.invalid"; process.env.SUPABASE_SERVICE_KEY = "test";
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin === "https://ledger.invalid") {
      assert.equal(url.searchParams.get("workspace_id"), `eq.${workspace}`);
      return Response.json([{ repository: "test/repo", token: "test-token" }]);
    }
    assert.equal(url.origin, "https://api.github.com");
    assert.ok(init?.signal, "every GitHub request has a deadline");
    return api(url.pathname.replace("/repos/test/repo", "") + url.search, init?.method ?? "GET", init?.body ? JSON.parse(String(init.body)) : undefined);
  });
}

test("atomic publication rebases both files after concurrent branch changes without force pushing", async (t) => {
  let attempt = 0, head = base;
  const recorded: PublicationCandidate[] = [], discarded: string[] = [], rebuilt: string[] = [];
  fixture(t, (path, method, body) => {
    if (!path) return Response.json({ default_branch: "release/main" });
    if (path === "/git/ref/heads/release/main") return Response.json({ object: { sha: head } });
    if (path === `/git/commits/${head}`) return Response.json({ tree: { sha: `tree-${head}` } });
    if (path === "/git/trees") {
      assert.equal(body.base_tree, `tree-${head}`); assert.equal(method, "POST");
      assert.equal(body.tree.length, 2); assert.equal(body.tree[1].content, `Notes at ${head}`);
      assert.ok(body.tree.every((file: any) => file.type === "blob" && file.mode === "100644"));
      return Response.json({ sha: "new-tree" });
    }
    if (path === "/git/commits") {
      assert.deepEqual(body.parents, [head]); attempt++;
      return Response.json({ sha: String(attempt).padStart(40, "0") });
    }
    if (path === "/git/refs/heads/release/main") {
      assert.equal(method, "PATCH"); assert.equal(body.force, false);
      assert.equal(recorded.at(-1)?.sha, body.sha, "candidate is durably saved before ref mutation");
      if (attempt === 1) { head = concurrent; return new Response(null, { status: 422 }); }
      return Response.json({ object: { sha: body.sha } });
    }
    throw new Error(`Unexpected ${path}`);
  });
  const result = await inWorkspace(workspace, () => publishFilesAtomically({
    message: "Approve agreement", files: async (sha) => {
      rebuilt.push(sha); return [{ path: "contracts/login.json", content: "{}" }, { path: "AGENTS.md", content: `Notes at ${sha}` }];
    }, recordCandidate: async (value) => { recorded.push(value); }, discardCandidate: async (sha) => { discarded.push(sha); },
  }));
  assert.equal(result, "2".padStart(40, "0")); assert.deepEqual(rebuilt, [base, concurrent]);
  assert.equal(recorded.length, 2); assert.deepEqual(discarded, ["1".padStart(40, "0")]);
});

for (const scenario of ["at-candidate", "descendant", "unpublished", "diverged"] as const) {
  test(`saved publication recovery handles ${scenario} without creating duplicate commits`, async (t) => {
    const moves: string[] = [], records: string[] = [];
    fixture(t, (path, method, body) => {
      if (!path) return Response.json({ default_branch: "main" });
      if (path === "/git/ref/heads/main") return Response.json({ object: { sha: scenario === "at-candidate" ? candidate : scenario === "unpublished" ? base : concurrent } });
      if (path.startsWith("/compare/")) return Response.json({ status: scenario === "descendant" ? "ahead" : scenario === "unpublished" ? "behind" : "diverged" });
      if (path === "/git/refs/heads/main") { assert.equal(method, "PATCH"); assert.equal(body.force, false); moves.push(body.sha); return Response.json({}); }
      throw new Error(`Recovery must not create Git objects: ${path}`);
    });
    const run = () => inWorkspace(workspace, () => publishFilesAtomically({ message: "Recover", pending: { branch: "main", baseSha: base, sha: candidate },
      files: async () => { throw new Error("Must use the saved candidate"); },
      recordCandidate: async (value) => { records.push(value.sha); }, discardCandidate: async () => { throw new Error("Cannot discard an ambiguous candidate"); },
    }));
    if (scenario === "diverged") await assert.rejects(run(), /Review its saved commit/);
    else assert.equal(await run(), candidate);
    assert.deepEqual(moves, scenario === "unpublished" ? [candidate] : []);
    assert.deepEqual(records, scenario === "unpublished" ? [candidate] : []);
  });
}

test("ambiguous ref failures preserve the saved candidate for the next request", async (t) => {
  const recorded: string[] = [];
  fixture(t, (path) => {
    if (!path) return Response.json({ default_branch: "main" });
    if (path === "/git/ref/heads/main") return Response.json({ object: { sha: base } });
    if (path.startsWith("/git/commits/")) return Response.json({ tree: { sha: "tree" } });
    if (path === "/git/trees") return Response.json({ sha: "new-tree" });
    if (path === "/git/commits") return Response.json({ sha: candidate });
    throw new Error("Connection lost after the ref may have been accepted");
  });
  await assert.rejects(inWorkspace(workspace, () => publishFilesAtomically({ message: "Publish",
    files: async () => [{ path: "contracts/login.json", content: "{}" }, { path: "AGENTS.md", content: "notes" }],
    recordCandidate: async (value) => { recorded.push(value.sha); }, discardCandidate: async () => { throw new Error("Must not discard"); },
  })), /Connection lost/);
  assert.deepEqual(recorded, [candidate]);
});

test("new branches inspect every source blob and reject incomplete GitHub file lists", async (t) => {
  let truncated = false, capped = false;
  fixture(t, (path) => {
    if (path.startsWith("/git/commits/")) return Response.json({ tree: { sha: "snapshot" } });
    if (path === "/git/trees/snapshot?recursive=1") return Response.json({ truncated, tree: [{ path: "earlier/Login.tsx", type: "blob" }, { path: "latest/server.ts", type: "blob" }, { path: "folder", type: "tree" }] });
    if (path.startsWith("/compare/")) return Response.json({ files: capped ? Array.from({ length: 300 }, (_, i) => ({ filename: `${i}.ts`, status: "modified" })) : [{ filename: "gone.ts", status: "removed" }, { filename: "kept.ts", status: "modified" }] });
    throw new Error(`Unexpected ${path}`);
  });
  assert.deepEqual(await inWorkspace(workspace, () => changedFiles("0".repeat(40), candidate)), ["earlier/Login.tsx", "latest/server.ts"]);
  assert.deepEqual(await inWorkspace(workspace, () => changedFiles(base, candidate)), ["kept.ts"]);
  truncated = true;
  await assert.rejects(inWorkspace(workspace, () => changedFiles("0".repeat(40), candidate)), /too large for a complete code check/);
  capped = true;
  await assert.rejects(inWorkspace(workspace, () => changedFiles(base, candidate)), /too large for a complete code check/);
});
