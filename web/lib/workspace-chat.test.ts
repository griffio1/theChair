import test from "node:test";
import assert from "node:assert/strict";
import { handleChat } from "../../server/chat";
import { inWorkspace, currentWorkspace } from "../../server/workspace-context";
const a = "10000000-0000-4000-8000-000000000001",
  b = "20000000-0000-4000-8000-000000000002";
test("failed AI proposals do not post database or provider error details into chat", async (t) => {
  const env = { SUPABASE_URL: "https://ledger.invalid", SUPABASE_SERVICE_KEY: "test", LLM_PROVIDER: "groq" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.groq.com") return Response.json({ choices: [{ message: { content: null, tool_calls: [{
      id: "call", type: "function", function: { name: "propose_contract", arguments: JSON.stringify({ id: "login", name: "Login", method: "POST", path: "/login", request: [], response: [], reason: "Propose login" }) },
    }] } }] });
    if ((init?.method ?? "GET") === "GET") return Response.json([]);
    if (url.pathname.endsWith("contracts")) return new Response("private-database-error", { status: 503 });
    return Response.json([{ ...JSON.parse(String(init?.body)), id: "message", created_at: "now" }]);
  });
  const result = await inWorkspace(a, () => handleChat({ author: "Owner", body: "Agree login" }));
  assert.equal(result.at(-1)?.body, "Couldn't create that agreement. Try again.");
  assert.ok(!JSON.stringify(result).includes("private-database-error"));
});
test("AI context, proposals and replies remain in the originating workspace", async (t) => {
  const env = {
    SUPABASE_URL: "https://ledger.invalid",
    SUPABASE_SERVICE_KEY: "test",
    LLM_PROVIDER: "groq",
    GROQ_API_KEY: "test",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, env);
  t.after(() => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const writes: any[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)),
        space = currentWorkspace(),
        other = space === a ? b : a;
      if (url.hostname === "api.groq.com") {
        const body = JSON.parse(String(init?.body));
        const prompt = JSON.stringify(body.messages);
        assert.ok(prompt.includes(space));
        assert.ok(!prompt.includes(other));
        return Response.json({
          choices: [
            {
              message: {
                content: "A scoped answer",
                tool_calls: [
                  {
                    id: "call",
                    type: "function",
                    function: {
                      name: "propose_contract",
                      arguments: JSON.stringify({
                        id: "same-id",
                        name: space,
                        method: "POST",
                        path: "/login",
                        request: [],
                        response: [],
                        reason: "Scoped proposal",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      const table = url.pathname.split("/").pop();
      if ((init?.method ?? "GET") === "GET") {
        assert.equal(url.searchParams.get("workspace_id"), `eq.${space}`);
        if (table === "contracts")
          return Response.json(
            url.searchParams.has("id")
              ? []
              : [
                  {
                    id: "existing",
                    name: space,
                    version: 1,
                    status: "approved",
                    method: "GET",
                    path: "/own",
                    request: [],
                    response: [],
                  },
                ],
          );
        return Response.json([
          {
            id: "history",
            author_type: "human",
            author_name: "Member",
            kind: "text",
            body: space,
            created_at: "now",
          },
        ]);
      }
      const row = JSON.parse(String(init?.body));
      assert.equal(row.workspace_id, space);
      writes.push(row);
      return Response.json([
        { ...row, id: row.id ?? "new", created_at: "now" },
      ]);
    },
  );
  await Promise.all(
    [a, b].map((space) =>
      inWorkspace(space, () =>
        handleChat({ author: "Member", body: "Make a scoped agreement" }),
      ),
    ),
  );
  for (const space of [a, b]) {
    const own = writes.filter((r) => r.workspace_id === space);
    assert.ok(own.some((r) => r.id === "same-id" && r.name === space));
    assert.ok(own.some((r) => r.body === "A scoped answer"));
  }
});
