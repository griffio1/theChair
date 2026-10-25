// Run from the repo root:
// node --env-file=web/.env.local --import tsx web/scripts/check-workspaces.ts
// Creates disposable, email-confirmed accounts without sending email; cleans up
// only the exact workspace/user IDs it created. Never prints credentials.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const secret = process.env.SUPABASE_SERVICE_KEY!;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const origin = process.env.WORKSPACE_CHECK_URL ?? "http://localhost:3000";
if (!url || !secret || !publicKey)
  throw new Error("Load the local Supabase environment first.");
const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const users: string[] = [];
const spaces: string[] = [];
let failures = 0;

async function request(
  path: string,
  token?: string,
  body?: object,
  extra: Record<string, string> = {},
) {
  const response = await fetch(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...extra,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, data: await response.json() };
}
async function account(label: string) {
  const email = `thechair-check-${label}-${randomBytes(8).toString("hex")}@example.com`;
  const password = randomBytes(32).toString("base64url");
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { displayName: `Test ${label}` },
  });
  if (created.error || !created.data.user)
    throw new Error(`Could not create test ${label} account.`);
  users.push(created.data.user.id);
  const client = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session)
    throw new Error(`Could not sign in test ${label} account.`);
  return {
    email,
    token: result.data.session.access_token,
    id: created.data.user.id,
  };
}
async function main() {
  try {
    const ready = await admin.from("contracts").select("workspace_id").limit(0);
    if (ready.error) throw new Error("Apply workspace-teams.sql first.");
    const alice = await account("teams-a"),
      bob = await account("teams-b");
    for (const owner of [alice, bob]) {
      const created = await request("/api/workspaces", owner.token, {
        name: "Disposable team integration",
      });
      assert.equal(created.status, 200);
      spaces.push(created.data.workspace.id);
    }
    const [a, b] = spaces;
    const headers = (workspace: string) => ({
      "x-thechair-workspace": workspace,
    });
    assert.equal(
      (await request(`/api/workspaces/${a}/integrations`, bob.token)).status,
      403,
    );
    assert.equal(
      (await request(`/api/workspaces/${a}/integrations`)).status,
      401,
    );
    for (const [owner, space] of [
      [alice, a],
      [bob, b],
    ] as const) {
      const proposed = await request(
        "/api/contracts/propose",
        owner.token,
        {
          contract: {
            id: "isolated-login",
            name: space,
            method: "POST",
            path: "/login",
            request: [],
            response: [],
          },
        },
        headers(space),
      );
      assert.equal(proposed.status, 200);
      assert.equal(proposed.data.version, 1);
      const contracts = await request(
        "/api/contracts?all=1",
        owner.token,
        undefined,
        headers(space),
      );
      assert.equal(contracts.status, 200);
      assert.equal(contracts.data.length, 1);
      assert.equal(contracts.data[0].name, space);
      const check = await request(
        "/api/preflight",
        owner.token,
        {
          intent: "Disposable workspace isolation test",
          paths: ["same/file.ts"],
          agent: "codex",
          developer: space,
          shapes: [],
        },
        headers(space),
      );
      assert.equal(check.status, 200);
      assert.ok(
        !check.data.conflicts.some((c: any) => c.kind === "path_overlap"),
      );
    }
    assert.equal(
      (await request("/api/contracts", alice.token, undefined, headers(b)))
        .status,
      403,
    );
    const issued = await request(
      `/api/workspaces/${a}/integrations/agents`,
      alice.token,
      { label: "Disposable agent" },
    );
    assert.equal(issued.status, 200);
    assert.match(issued.data.token, /^[a-f0-9]{64}$/);
    const agent = { "x-thechair-agent-token": issued.data.token };
    const read = await request(
      "/api/contracts?all=1",
      undefined,
      undefined,
      agent,
    );
    assert.equal(read.status, 200);
    assert.equal(read.data[0].name, a);
    assert.equal(
      (
        await request("/api/contracts", undefined, undefined, {
          ...agent,
          ...headers(b),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/api/contracts/isolated-login/approve",
          undefined,
          { version: 1 },
          agent,
        )
      ).status,
      401,
    );
    const listed = await request(
      `/api/workspaces/${a}/integrations`,
      alice.token,
    );
    assert.equal(listed.status, 200);
    assert.ok(!JSON.stringify(listed.data).includes(issued.data.token));
    assert.ok(!JSON.stringify(listed.data).includes("token_hash"));
    assert.equal(
      (
        await request(
          `/api/workspaces/${b}/integrations/agents/${issued.data.credential.id}/revoke`,
          bob.token,
          {},
        )
      ).status,
      404,
    );
    const revoked = await request(
      `/api/workspaces/${a}/integrations/agents/${issued.data.credential.id}/revoke`,
      alice.token,
      {},
    );
    assert.equal(revoked.status, 200);
    assert.equal(
      (await request("/api/contracts", undefined, undefined, agent)).status,
      401,
    );
    if (process.env.WORKSPACE_CHECK_AI === "1") {
      const chat = await request(
        "/api/chat",
        alice.token,
        {
          body: "Reply with one short sentence confirming you are ready. Do not propose a contract.",
        },
        headers(a),
      );
      assert.equal(chat.status, 200, "Live AI chat succeeds");
      assert.ok(
        chat.data.some((m: any) => m.author.type === "ai" && m.body?.trim()),
        "Live AI returns an answer",
      );
      console.log("Live AI chat passed in a disposable workspace.");
    }
    // Test HMAC routing with disposable database fixtures. Ping never contacts GitHub.
    for (let i = 0; i < 2; i++) {
      const secret = randomBytes(32).toString("hex"),
        repoId = 8_000_000_000 + Math.floor(Math.random() * 100_000_000);
      const insert = await admin.from("chair_repository_connections").insert({
        workspace_id: spaces[i],
        repository_id: repoId,
        repository: `test-disposable/${randomUUID()}`,
        token: "unused-ping-fixture",
        webhook_secret: secret,
        connected_by: i === 0 ? alice.id : bob.id,
      });
      assert.equal(insert.error, null);
      const payload = { repository: { id: repoId } },
        raw = JSON.stringify(payload),
        signature =
          "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
      assert.equal(
        (
          await request("/api/github/webhook", undefined, payload, {
            "x-github-event": "ping",
            "x-hub-signature-256": signature,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            "/api/github/webhook",
            undefined,
            { repository: { id: repoId + 1 } },
            { "x-github-event": "ping", "x-hub-signature-256": signature },
          )
        ).status,
        401,
      );
    }
    const member = await admin.from("chair_memberships").insert({
      workspace_id: a,
      user_id: bob.id,
      display_name: "Member",
      role: "member",
    });
    assert.equal(member.error, null);
    assert.equal(
      (await request("/api/contracts?all=1", bob.token, undefined, headers(a)))
        .status,
      200,
    );
    assert.equal(
      (await request(`/api/workspaces/${a}/integrations`, bob.token)).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/api/contracts/isolated-login/approve",
          bob.token,
          { version: 1 },
          headers(a),
        )
      ).status,
      403,
    );
    console.log(
      "Workspace teams passed: separate ledgers and claims, owner-only connections, agent scoping/revocation, signed webhook routing, and member restrictions.",
    );
  } finally {
    for (const id of spaces) {
      const r = await admin.from("chair_workspaces").delete().eq("id", id);
      if (r.error) throw new Error("Disposable workspace cleanup failed.");
    }
    for (const id of users) {
      const r = await admin.auth.admin.deleteUser(id);
      if (r.error) throw new Error("Disposable user cleanup failed.");
    }
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Integration check failed");
  process.exitCode = 1;
});
