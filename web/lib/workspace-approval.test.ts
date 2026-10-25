import test from "node:test";
import assert from "node:assert/strict";
import { approveContract, approveConflict, ApprovalError } from "../../server/approve";
import { inWorkspace, currentWorkspace } from "../../server/workspace-context";
import { approvalDatabase } from "./approval-publishing-fixture";

const a = "10000000-0000-4000-8000-000000000001", b = "20000000-0000-4000-8000-000000000002";
test("approval HTTP flow isolates repositories, retries an accepted Git ref, and replays completed requests", async (t) => {
  const db = await approvalDatabase();
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };
  process.env.SUPABASE_URL = "https://ledger.invalid"; process.env.SUPABASE_SERVICE_KEY = "test";
  t.after(async () => {
    for (const [key, value] of Object.entries({ SUPABASE_URL: previous.url, SUPABASE_SERVICE_KEY: previous.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db.close();
  });
  await db.query("insert into chair_workspaces values($1),($2)", [a, b]);
  await db.query(`insert into contracts(workspace_id,id,version,name,method,path,status)
    select w,'login',v,'Login','POST','/login','proposed' from unnest($1::uuid[])w cross join generate_series(1,3)v`, [[a, b]]);
  const heads = new Map([[a, "a".repeat(40)], [b, "b".repeat(40)]]);
  const commits: string[] = [], trees: { space: string; body: any }[] = [], moves: string[] = [];
  let failFinish = false, failGit = false;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)), space = currentWorkspace(), method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.hostname === "api.github.com") {
      const prefix = `/repos/owner/${space}`;
      assert.ok(url.pathname.startsWith(prefix));
      assert.equal((init?.headers as any).authorization, `Bearer token-${space}`);
      const path = url.pathname.slice(prefix.length);
      if (failGit) return Response.json({ message: "private-error" }, { status: 403 });
      if (!path) return Response.json({ default_branch: "main" });
      if (path === "/git/ref/heads/main") return Response.json({ object: { sha: heads.get(space) } });
      if (path.startsWith("/git/commits/") && method === "GET") return Response.json({ tree: { sha: "tree-base" } });
      if (path.startsWith("/contents/")) {
        assert.equal(url.searchParams.get("ref"), heads.get(space));
        return path.endsWith("AGENTS.md") ? Response.json({ sha: "blob", content: Buffer.from("# Team\nKeep these team notes.\n").toString("base64") }) : new Response(null, { status: 404 });
      }
      if (path === "/git/trees") { trees.push({ space, body }); return Response.json({ sha: "tree-new" }); }
      if (path === "/git/commits") {
        assert.deepEqual(body.parents, [heads.get(space)]);
        commits.push(space); return Response.json({ sha: String(commits.length).padStart(40, "0") });
      }
      if (path === "/git/refs/heads/main") {
        assert.equal(method, "PATCH"); assert.equal(body.force, false);
        heads.set(space, body.sha); moves.push(space); return Response.json({ object: { sha: body.sha } });
      }
      throw new Error(`Unexpected GitHub route: ${path}`);
    }
    if (url.pathname.endsWith("chair_repository_connections")) {
      assert.equal(url.searchParams.get("workspace_id"), `eq.${space}`);
      return Response.json([{ repository: `owner/${space}`, token: `token-${space}` }]);
    }
    if (url.pathname.endsWith("contracts")) {
      assert.equal(url.searchParams.get("workspace_id"), `eq.${space}`);
      return Response.json((await db.query("select * from contracts where workspace_id=$1 and status='approved' order by version desc", [space])).rows);
    }
    const name = url.pathname.split("/").pop()!;
    assert.ok(["chair_take_approval", "chair_stage_approval", "chair_finish_approval", "chair_release_approval"].includes(name));
    assert.equal(body.p_workspace, space);
    if (failFinish && name === "chair_finish_approval") {
      failFinish = false; return Response.json({ code: "XX000", message: "private-error" }, { status: 503 });
    }
    try {
      const values = Object.values(body);
      const call = Object.keys(body).map((key, n) => `${key} => $${n + 1}`).join(",");
      const result = (await db.query<{ result: any }>(`select ${name}(${call}) result`, values)).rows[0].result;
      return Response.json(result);
    } catch (error: any) { return Response.json({ code: error.code, message: error.message }, { status: 400 }); }
  });

  const results = await Promise.all([a, b].map((space) => inWorkspace(space, () => approveContract("login", 1, "Owner"))));
  assert.ok(results.every((result) => result.contract.status === "approved"));
  assert.equal(commits.length, 2); assert.equal(trees.length, 2); assert.equal(moves.length, 2);
  for (const { body } of trees) {
    assert.deepEqual(body.tree.map((file: any) => file.path), ["contracts/login.json", "AGENTS.md"]);
    assert.match(body.tree[1].content, /Keep these team notes/);
    assert.match(body.tree[1].content, /login v1/);
  }
  await inWorkspace(a, () => approveContract("login", 1, "Another owner"));
  assert.equal(commits.length, 2, "completed replay does not create another commit");

  failFinish = true;
  await assert.rejects(inWorkspace(a, () => approveContract("login", 2, "Owner")), (error: unknown) => error instanceof ApprovalError && error.status === 503 && !error.message.includes("private-error"));
  assert.equal(commits.length, 3, "Git ref was accepted before database failure");
  assert.equal((await db.query<{ status: string }>("select status from contracts where workspace_id=$1 and version=2", [a])).rows[0].status, "proposed");
  await inWorkspace(a, () => approveContract("login", 2, "Owner"));
  assert.equal(commits.length, 3, "retry reconciles the saved commit without publishing again");
  assert.equal((await db.query<{ total: number }>("select count(*)::int total from events where workspace_id=$1", [a])).rows[0].total, 2);

  failGit = true;
  await assert.rejects(inWorkspace(b, () => approveContract("login", 2, "Owner")), /403/);
  assert.equal((await db.query<{ status: string }>("select status from contracts where workspace_id=$1 and version=2", [b])).rows[0].status, "proposed");
  failGit = false;
  const raced = await Promise.allSettled([1, 2].map(() => inWorkspace(b, () => approveContract("login", 2, "Owner"))));
  assert.ok(raced.some((result) => result.status === "fulfilled"));
  assert.equal(commits.filter((space) => space === b).length, 2, "same-workspace race publishes at most once");
  await assert.rejects(inWorkspace(a, () => approveConflict("30000000-0000-4000-8000-000000000003", "Owner")), (error: unknown) => error instanceof ApprovalError && error.status === 404);
});
