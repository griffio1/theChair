import test from "node:test";
import assert from "node:assert/strict";
import { consumeWorkspaceBudget } from "./production-limits";
import { respond } from "./workspace-server";

test("server usage checks send only verified scope and fail closed without exposing database errors", async (t) => {
  const workspace = "10000000-0000-4000-8000-000000000001", actor = "20000000-0000-4000-8000-000000000002";
  const previous = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY };
  Object.assign(process.env,{ SUPABASE_URL: "https://database.invalid", SUPABASE_SERVICE_KEY: "test-service-key" });
  t.after(() => { for (const [key,value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  let code = "", requests = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requests++;
    assert.equal(new URL(String(input)).pathname,"/rest/v1/rpc/chair_consume_server_budget");
    assert.deepEqual(JSON.parse(String(init?.body)),{p_workspace:workspace,p_actor:actor,p_action:"ai_chat"});
    assert.equal(new Headers(init?.headers).get("authorization"),"Bearer test-service-key");
    if (code === "network") throw new Error("private network detail");
    return code ? Response.json({ code, message: code === "PT429" ? "Usage limit reached. Wait a while and try again." : "private database detail" },{status:code === "PT429" ? 429 : 400}) : new Response(null,{status:204});
  });
  await consumeWorkspaceBudget(workspace,actor,"ai_chat");
  for (const [failure,status] of [["PT429",429],["42501",403],["PGRST202",503],["42P01",503],["network",503]] as const) {
    code = failure;
    const response = await respond(() => consumeWorkspaceBudget(workspace,actor,"ai_chat"));
    assert.equal(response.status,status);
    assert.doesNotMatch(await response.text(),/private (database|network) detail/);
    assert.equal(response.headers.get("cache-control"),"no-store, private");
  }
  const before = requests;
  assert.equal((await respond(() => consumeWorkspaceBudget(workspace,"forged","ai_chat"))).status,400);
  assert.equal(requests,before,"malformed actor is rejected before a service-key request");
});
