import test from "node:test";
import assert from "node:assert/strict";
import { requireTeam } from "./legacy-access";
import { WorkspaceError } from "./workspace-server";

test("team access rejects unsigned calls and excludes agent credentials from human-only actions", async () => {
  for (const options of [{}, { allowAgent: true }, { ownerOnly: true }])
    await assert.rejects(
      requireTeam(new Request("http://localhost"), options),
      (e: unknown) => e instanceof WorkspaceError && e.status === 401,
    );
  const req = new Request("http://localhost", {
    headers: { "x-thechair-agent-token": "a".repeat(64) },
  });
  await assert.rejects(
    requireTeam(req, { ownerOnly: true }),
    (e: unknown) => e instanceof WorkspaceError && e.status === 401,
  );
  await assert.rejects(
    requireTeam(req),
    (e: unknown) => e instanceof WorkspaceError && e.status === 401,
  );
});

test("agent credentials must be active, scoped to their workspace, and issued by a current owner", async (t) => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL,
    oldKey = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL = "https://database.invalid";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = oldKey;
  });
  let active = true,
    bound = true,
    owner = true;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("chair_agent_credentials")) {
      assert.equal(url.searchParams.get("revoked_at"), "is.null");
      assert.match(url.searchParams.get("expires_at")!, /^gt\./);
      assert.match(url.searchParams.get("token_hash")!, /^eq\.[a-f0-9]{64}$/);
      return Response.json(
        active
          ? [{ workspace_id: "team", issued_by: "owner", label: "carter" }]
          : [],
      );
    }
    if (url.pathname.endsWith("chair_legacy_binding"))
      return Response.json(bound ? [{ workspace_id: "team" }] : []);
    if (url.pathname.endsWith("chair_memberships")) {
      assert.equal(url.searchParams.get("role"), "eq.owner");
      return Response.json(owner ? [{ user_id: "owner" }] : []);
    }
    throw new Error("Unexpected outbound request");
  };
  const req = new Request("http://localhost", {
    headers: { "x-thechair-agent-token": "a".repeat(64) },
  });
  assert.deepEqual(await requireTeam(req, { allowAgent: true }), {
    workspaceId: "team",
    name: "carter",
    role: "agent",
    budgetActorId: "owner",
  });
  active = false;
  await assert.rejects(
    requireTeam(req, { allowAgent: true }),
    (e: unknown) => e instanceof WorkspaceError && e.status === 401,
  );
  active = true;
  bound = false;
  await assert.rejects(
    requireTeam(
      new Request("http://localhost", {
        headers: {
          "x-thechair-agent-token": "a".repeat(64),
          "x-thechair-workspace": "another-team",
        },
      }),
      { allowAgent: true },
    ),
    (e: unknown) => e instanceof WorkspaceError && e.status === 403,
  );
  bound = true;
  owner = false;
  await assert.rejects(
    requireTeam(req, { allowAgent: true }),
    (e: unknown) => e instanceof WorkspaceError && e.status === 403,
  );
});
