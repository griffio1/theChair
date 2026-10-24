import test from "node:test";
import assert from "node:assert/strict";
import { inWorkspace, currentWorkspace } from "../../server/workspace-context";
import { select, insert, update } from "../../server/db";
const a = "10000000-0000-4000-8000-000000000001",
  b = "20000000-0000-4000-8000-000000000002";
test("ledger access fails closed without a workspace and concurrent requests stay isolated", async (t) => {
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY,
  };
  process.env.SUPABASE_URL = "https://ledger.invalid";
  process.env.SUPABASE_SERVICE_KEY = "test";
  t.after(() => {
    for (const [k, v] of [
      ["SUPABASE_URL", previous.url],
      ["SUPABASE_SERVICE_KEY", previous.key],
    ]) {
      if (v === undefined) delete process.env[k!];
      else process.env[k!] = v;
    }
  });
  const calls: { workspace: string; url: URL; body: any }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise((r) => setTimeout(r, 1));
      calls.push({
        workspace: currentWorkspace(),
        url: new URL(String(input)),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json([]);
    },
  );
  assert.throws(() => select("messages"), /verified workspace/);
  assert.throws(() => insert("contracts", {}), /verified workspace/);
  await Promise.all(
    [a, b].map((id) =>
      inWorkspace(id, async () => {
        await select(
          "messages",
          `workspace_id=eq.${id === a ? b : a}&workspace_id=eq.evil&limit=5`,
        );
        await insert("messages", { workspace_id: "spoof", body: "hello" });
        await update("contracts", "id=eq.login", {
          workspace_id: "spoof",
          status: "approved",
        });
      }),
    ),
  );
  for (const call of calls) {
    if (call.url.searchParams.has("workspace_id"))
      assert.deepEqual(call.url.searchParams.getAll("workspace_id"), [
        `eq.${call.workspace}`,
      ]);
    if (call.body) assert.equal(call.body.workspace_id, call.workspace);
  }
  assert.throws(() => currentWorkspace(), /verified workspace/);
});
