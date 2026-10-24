// Run from the repo root:
// node --env-file=web/.env.local --import tsx web/scripts/check-workspaces.ts
// Creates disposable, email-confirmed accounts without sending email; cleans up
// only the exact workspace/user IDs it created. Never prints credentials.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
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

async function request(path: string, token?: string, body?: object) {
  const response = await fetch(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
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
    const ready = await admin.from("chair_workspaces").select("id").limit(0);
    if (ready.error)
      throw new Error(
        "Workspace migration is not installed or accessible. Run web/sql/workspaces.sql first.",
      );
    assert.equal((await request("/api/workspaces")).status, 401);
    const owner = await account("owner"),
      member = await account("member"),
      outsider = await account("outsider");
    const created = await request("/api/workspaces", owner.token, {
      name: "Disposable workspace check",
    });
    assert.equal(created.status, 200, "workspace creation failed");
    const w = created.data.workspace.id;
    const c = created.data.chat.id;
    spaces.push(w);
    const second = await request("/api/workspaces", owner.token, {
      name: "Disposable isolation check",
    });
    assert.equal(second.status, 200);
    spaces.push(second.data.workspace.id);
    const base = `/api/workspaces/${w}`;
    assert.equal((await request(base, outsider.token)).status, 404);
    assert.equal(
      (await request("/api/workspaces", outsider.token)).data.workspaces.length,
      0,
    );
    const createdChat = await request(`${base}/chats`, owner.token, {
      title: "Separate chat",
    });
    assert.equal(createdChat.status, 200, "chat creation failed");
    assert.ok(createdChat.data.chat.id);
    const payload = {
      body: "A scoped test message",
      clientMessageId: randomUUID(),
    };
    const sent = await request(
      `${base}/chats/${c}/messages`,
      owner.token,
      payload,
    );
    assert.equal(sent.status, 200, "message send failed");
    assert.equal(sent.data.messages[0].author.userId, owner.id);
    assert.equal(
      (await request(`${base}/chats/${c}/messages`, owner.token, payload))
        .status,
      200,
    );
    assert.equal(
      (await request(`${base}/chats/${c}/messages`, owner.token)).data.messages
        .length,
      1,
    );
    assert.equal(
      (
        await request(
          `${base}/chats/${createdChat.data.chat.id}/messages`,
          owner.token,
        )
      ).data.messages.length,
      0,
    );
    assert.equal(
      (
        await request(
          `${base}/chats/${second.data.chat.id}/messages`,
          owner.token,
          payload,
        )
      ).status,
      404,
    );
    assert.equal(
      (await request(`${base}/chats/${c}/messages`, outsider.token, payload))
        .status,
      404,
    );
    const invite = await request(`${base}/invitations`, owner.token, {
      email: member.email,
    });
    assert.equal(invite.status, 200, "invitation creation failed");
    const token = new URLSearchParams(
      new URL(invite.data.invitation.inviteUrl, origin).hash.slice(1),
    ).get("invite");
    assert.ok(token);
    assert.equal(
      (await request("/api/invitations/accept", outsider.token, { token }))
        .status,
      403,
    );
    assert.equal(
      (await request("/api/invitations/accept", member.token, { token })).data
        .workspaceId,
      w,
    );
    assert.equal(
      (await request("/api/invitations/accept", member.token, { token })).data
        .workspaceId,
      w,
    );
    const detail = await request(base, member.token);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.members.length, 2);
    assert.equal(detail.data.workspace.role, "member");
    assert.deepEqual(detail.data.invitations, []);
    assert.deepEqual(detail.data.contracts, []);
    assert.deepEqual(detail.data.conflicts, []);
    assert.equal(
      (
        await request(`${base}/invitations`, member.token, {
          email: outsider.email,
        })
      ).status,
      403,
    );
    assert.equal(
      (await request(`${base}/chats/${c}/messages`, member.token)).data.messages
        .length,
      1,
    );
    assert.equal(
      (
        await request(
          `/api/workspaces/${second.data.workspace.id}`,
          member.token,
        )
      ).status,
      404,
    );
    console.log(
      "PASS: real workspace creation, chat persistence, member sharing, invitations, retries, and outsider isolation.",
    );
  } catch (error) {
    failures++;
    const message =
      error instanceof Error ? error.message : "Integration check failed";
    console.error(message.split(secret).join("[redacted]"));
  } finally {
    for (const id of spaces) {
      const result = await admin.from("chair_workspaces").delete().eq("id", id);
      if (result.error) {
        failures++;
        console.error(`Cleanup needed for test workspace ${id}`);
      }
    }
    for (const id of users) {
      const result = await admin.auth.admin.deleteUser(id);
      if (result.error) {
        failures++;
        console.error(`Cleanup needed for test user ${id}`);
      }
    }
    if (!failures) console.log("PASS: disposable test data removed.");
    process.exitCode = failures ? 1 : 0;
  }
}
void main().catch(() => {
  console.error(
    "Workspace check could not finish; inspect disposable test cleanup.",
  );
  process.exitCode = 1;
});
