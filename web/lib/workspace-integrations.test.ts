import test from "node:test";
import assert from "node:assert/strict";
import { integrationsRequest } from "./workspace-integrations";
import { WorkspaceError } from "./workspace-server";
const team = "10000000-0000-4000-8000-000000000001",
  other = "20000000-0000-4000-8000-000000000002",
  user = "30000000-0000-4000-8000-000000000003";
test("owner integration routes scope writes, hash agent tokens, and never return repository secrets", async (t) => {
  const vars = {
    SUPABASE_URL: "https://database.invalid",
    SUPABASE_SERVICE_KEY: "service-test",
    NEXT_PUBLIC_SUPABASE_URL: "https://database.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test",
  };
  const previous = Object.fromEntries(
    Object.keys(vars).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, vars);
  t.after(() => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  let role = "owner",
    githubAdmin = false;
  let githubStatus = 200, rateLimited = false, malformedGithub = false;
  const writes: any[] = [];
  const json = (v: unknown) => Response.json(v);
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (url.pathname.endsWith("/auth/v1/user"))
        return json({
          id: user,
          email: "test@example.com",
          aud: "authenticated",
          app_metadata: {},
          user_metadata: {},
        });
      if (url.hostname === "api.github.com") {
        if (!githubStatus) throw new Error("Network unavailable");
        if (malformedGithub) return new Response("not JSON");
        return Response.json({
          id: 42,
          full_name: "Owner/Repo",
          permissions: { admin: githubAdmin, push: true },
        }, { status: githubStatus, headers: rateLimited ? { "x-ratelimit-remaining": "0" } : {} });
      }
      if (url.pathname.endsWith("chair_memberships")) {
        assert.equal(url.searchParams.get("workspace_id"), `eq.${team}`);
        return json([{ role, display_name: "Owner" }]);
      }
      if (url.pathname.endsWith("chair_repository_connections")) {
        if (method === "POST") {
          const body = JSON.parse(String(init?.body));
          writes.push(body);
          return json({
            repository: body.repository,
            repository_id: 42,
            connected_at: "now",
          });
        }
        assert.equal(url.searchParams.get("workspace_id"), `eq.${team}`);
        return json([]);
      }
      if (url.pathname.endsWith("chair_agent_credentials")) {
        if (method === "POST") {
          const body = JSON.parse(String(init?.body));
          writes.push(body);
          return json({
            id: other,
            label: body.label,
            created_at: "now",
            expires_at: body.expires_at,
            revoked_at: null,
          });
        }
        assert.equal(url.searchParams.get("workspace_id"), `eq.${team}`);
        assert.ok(!url.searchParams.get("select")?.includes("token_hash"));
        return json([]);
      }
      throw new Error("Unexpected request");
    },
  );
  const req = (body?: object) =>
    new Request("https://chair.example/api", {
      method: body ? "POST" : "GET",
      headers: {
        authorization: "Bearer session",
        "content-type": "application/json",
        "x-thechair-workspace": other,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const issued: any = await integrationsRequest(req({ label: "Agent" }), team, [
    "agents",
  ]);
  assert.match(issued.token, /^[a-f0-9]{64}$/);
  assert.notEqual(writes[0].token_hash, issued.token);
  assert.equal(writes[0].workspace_id, team);
  assert.equal(writes[0].issued_by, user);
  const listing = await integrationsRequest(req(), team, []);
  assert.ok(!JSON.stringify(listing).includes(issued.token));
  const repo = {
    repository: "owner/repo",
    token: "private-token",
    webhookSecret: "s".repeat(32),
  };
  await assert.rejects(
    integrationsRequest(req(repo), team, ["repository"]),
    (e: unknown) => e instanceof WorkspaceError && e.status === 403,
  );
  githubAdmin = true;
  for (githubStatus of [0, 429, 500, 502, 503, 403]) {
    rateLimited = githubStatus === 403;
    await assert.rejects(integrationsRequest(req(repo), team, ["repository"]),
      (e: unknown) => e instanceof WorkspaceError && e.status === 503);
    assert.equal(writes.length, 1, "GitHub failures must not replace the stored connection");
  }
  rateLimited = false;
  for (githubStatus of [401, 403, 404])
    await assert.rejects(integrationsRequest(req(repo), team, ["repository"]),
      (e: unknown) => e instanceof WorkspaceError && e.status === 400);
  githubStatus = 200;
  malformedGithub = true;
  await assert.rejects(integrationsRequest(req(repo), team, ["repository"]),
    (e: unknown) => e instanceof WorkspaceError && e.status === 503);
  malformedGithub = false;
  const connected = await integrationsRequest(req(repo), team, ["repository"]);
  assert.ok(!JSON.stringify(connected).includes(repo.token));
  assert.ok(!JSON.stringify(connected).includes(repo.webhookSecret));
  assert.equal(writes[1].workspace_id, team);
  role = "member";
  await assert.rejects(
    integrationsRequest(req(), team, []),
    (e: unknown) => e instanceof WorkspaceError && e.status === 403,
  );
});
