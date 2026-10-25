// node --env-file=web/.env.local --import tsx web/scripts/check-team-access.ts
// Disposable account only; no real chat messages, proposals or approvals are made.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL!,
    pub = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const origin = process.env.WORKSPACE_CHECK_URL ?? "http://localhost:3000";
  let userId: string | undefined;
  let workspaceId: string | undefined;
  async function request(
    path: string,
    headers: Record<string, string> = {},
    body?: object,
  ) {
    const r = await fetch(`${origin}${path}`, {
      redirect: "manual",
      method: body ? "POST" : "GET",
      headers: {
        ...headers,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const content = await r.text();
    return {
      status: r.status,
      location: r.headers.get("location"),
      data:
        content.startsWith("{") || content.startsWith("[")
          ? JSON.parse(content)
          : null,
    };
  }
  try {
    const binding = await admin
      .from("chair_legacy_binding")
      .select("workspace_id")
      .single();
    if (binding.error) throw new Error("Apply secure-team.sql first.");
    workspaceId = binding.data.workspace_id;
    // The home page is the public landing page; private routes are checked below.
    assert.equal((await request("/")).status, 200);
    const paths = [
      "/api/chat",
      "/api/preflight",
      "/api/contracts/propose",
      "/api/contracts/auth-login/approve",
      "/api/conflicts/10000000-0000-4000-8000-000000000001/approve",
    ];
    assert.equal((await request("/api/contracts")).status, 401);
    for (const path of paths)
      assert.equal((await request(path, {}, {})).status, 401);
    const anon = createClient(url, pub, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const table of [
      "contracts",
      "messages",
      "conflicts",
      "events",
      "claims",
      "extraction_cache",
      "chair_agent_credentials",
    ]) {
      const r = await anon.from(table).select("*").limit(1);
      assert.ok(r.error, `anonymous database access denied for ${table}`);
    }
    const email = `thechair-auth-check-${randomBytes(8).toString("hex")}@example.com`,
      password = randomBytes(32).toString("base64url");
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user)
      throw new Error("Could not create the disposable account.");
    userId = created.data.user.id;
    const signed = await anon.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session)
      throw new Error("Could not sign in the disposable account.");
    const headers = {
      authorization: `Bearer ${signed.data.session.access_token}`,
    };
    assert.equal((await request("/api/contracts", headers)).status, 403);
    for (const path of paths)
      assert.equal((await request(path, headers, {})).status, 403);
    for (const table of [
      "contracts",
      "messages",
      "conflicts",
      "events",
      "claims",
    ]) {
      const r = await anon.from(table).select("*").limit(1);
      assert.equal(r.error, null);
      assert.equal(r.data?.length, 0, `outsider cannot read ${table}`);
    }
    const joined = await admin
      .from("chair_memberships")
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        display_name: "Disposable access check",
        role: "member",
      });
    if (joined.error)
      throw new Error("Could not add disposable test membership.");
    const contracts = await request("/api/contracts", headers);
    assert.equal(contracts.status, 200);
    assert.ok(
      contracts.data.some((c: { id: string }) => c.id === "auth-login"),
    );
    assert.equal(
      (
        await request("/api/contracts/auth-login/approve", headers, {
          version: 0,
          approvedBy: "spoof",
        })
      ).status,
      403,
    );
    const memberRead = await anon
      .from("contracts")
      .select("id")
      .eq("id", "auth-login");
    assert.equal(memberRead.error, null);
    assert.ok(memberRead.data?.length);
    assert.ok((await anon.from("chair_agent_credentials").select("*")).error);
    const promoted = await admin
      .from("chair_memberships")
      .update({ role: "owner" })
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    assert.equal(promoted.error, null);
    // Invalid version reaches validation only after owner authorization; no approval occurs.
    assert.equal(
      (
        await request("/api/contracts/auth-login/approve", headers, {
          version: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("/api/chat", headers, { author: "spoof", body: "" }))
        .status,
      400,
    );
    if (process.env.THECHAIR_AGENT_TOKEN) {
      const agent = {
        "x-thechair-agent-token": process.env.THECHAIR_AGENT_TOKEN,
      };
      assert.equal((await request("/api/contracts", agent)).status, 200);
      assert.equal(
        (
          await request("/api/contracts/auth-login/approve", agent, {
            version: 1,
          })
        ).status,
        401,
      );
      assert.equal(
        (await request("/api/chat", agent, { body: "No write should occur" }))
          .status,
        401,
      );
    }
    console.log(
      "PASS: anonymous and outsider API/DB access denied; team membership, owner-only approvals, and scoped agents verified.",
    );
  } finally {
    if (userId) {
      if (workspaceId) {
        const r = await admin
          .from("chair_memberships")
          .delete()
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId);
        if (r.error)
          throw new Error(`Remove temporary test membership for ${userId}`);
      }
      const r = await admin.auth.admin.deleteUser(userId);
      if (r.error) throw new Error(`Remove temporary test user ${userId}`);
      console.log(
        "PASS: temporary account and membership removed; original team data preserved.",
      );
    }
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Team access check failed");
  process.exitCode = 1;
});
