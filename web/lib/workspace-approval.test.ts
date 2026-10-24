import test from "node:test";
import assert from "node:assert/strict";
import { approveContract, approveConflict } from "../../server/approve";
import { inWorkspace, currentWorkspace } from "../../server/workspace-context";
const a = "10000000-0000-4000-8000-000000000001",
  b = "20000000-0000-4000-8000-000000000002";
test("approvals publish only to the current workspace repository and GitHub failure leaves status unchanged", async (t) => {
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY,
  };
  process.env.SUPABASE_URL = "https://ledger.invalid";
  process.env.SUPABASE_SERVICE_KEY = "test";
  t.after(() => {
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previous.key;
  });
  let failGithub = false;
  const publications: string[] = [],
    updates: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)),
        space = currentWorkspace(),
        method = init?.method ?? "GET";
      if (url.hostname === "api.github.com") {
        assert.ok(url.pathname.startsWith(`/repos/owner/${space}/contents/`));
        assert.equal(
          (init?.headers as any).authorization,
          `Bearer token-${space}`,
        );
        if (method === "GET") return new Response("", { status: 404 });
        if (failGithub) return new Response("", { status: 403 });
        publications.push(space);
        return Response.json({ commit: { sha: "test-commit" } });
      }
      if (url.pathname.endsWith("chair_repository_connections")) {
        assert.equal(url.searchParams.get("workspace_id"), `eq.${space}`);
        return Response.json([
          { repository: `owner/${space}`, token: `token-${space}` },
        ]);
      }
      if (method === "GET") {
        assert.equal(url.searchParams.get("workspace_id"), `eq.${space}`);
        if (url.pathname.endsWith("conflicts")) return Response.json([]);
        return Response.json(
          url.searchParams.has("version")
            ? [
                {
                  id: "login",
                  version: 1,
                  name: space,
                  status: "proposed",
                  method: "POST",
                  path: "/login",
                  request: [],
                  response: [],
                },
              ]
            : [],
        );
      }
      const row = JSON.parse(String(init?.body));
      assert.equal(row.workspace_id, space);
      if (method === "PATCH") updates.push(space);
      return Response.json([{ ...row, id: "test", created_at: "now" }]);
    },
  );
  await Promise.all(
    [a, b].map((id) =>
      inWorkspace(id, () => approveContract("login", 1, "Owner")),
    ),
  );
  assert.equal(publications.filter((id) => id === a).length, 2);
  assert.equal(publications.filter((id) => id === b).length, 2);
  assert.deepEqual(updates.sort(), [a, b]);
  failGithub = true;
  updates.length = 0;
  await assert.rejects(
    inWorkspace(a, () => approveContract("login", 1, "Owner")),
    /403/,
  );
  assert.equal(updates.length, 0);
  await assert.rejects(
    inWorkspace(b, () => approveConflict("not-in-this-workspace", "Owner")),
    /No conflict/,
  );
});
