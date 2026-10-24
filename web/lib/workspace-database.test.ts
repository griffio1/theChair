import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("workspace SQL enforces isolation, ownership, invitation identity and retry safety", async (t) => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const member = "10000000-0000-4000-8000-000000000002";
  const outsider = "10000000-0000-4000-8000-000000000003";
  const unconfirmed = "10000000-0000-4000-8000-000000000004";
  const token = "a".repeat(64);
  const messageId = "20000000-0000-4000-8000-000000000001";
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
    `);
    for (const [id, email, confirmed] of [
      [owner, "owner@example.com", true],
      [member, "member@example.com", true],
      [outsider, "outsider@example.com", true],
      [unconfirmed, "unconfirmed@example.com", false],
    ]) {
      await db.query(
        "insert into auth.users(id,email,email_confirmed_at) values ($1,$2,case when $3 then now() else null end)",
        [id, email, confirmed],
      );
    }
    const sql = await readFile(
      new URL("../sql/workspaces.sql", import.meta.url),
      "utf8",
    );
    await db.exec(sql);
    // Reapplying the migration must preserve data and policies.
    await db.exec(sql);
    const asUser = async (id: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    };
    await asUser(owner);
    const first = (
      await db.query<{
        value: { workspace: { id: string }; chat: { id: string } };
      }>("select public.chair_create_workspace('First') as value")
    ).rows[0].value;
    const second = (
      await db.query<{
        value: { workspace: { id: string }; chat: { id: string } };
      }>("select public.chair_create_workspace('Second') as value")
    ).rows[0].value;
    const w = first.workspace.id,
      c = first.chat.id;

    await t.test(
      "creation atomically adds owner and General chat",
      async () => {
        assert.equal(
          (
            await db.query(
              "select * from public.chair_memberships where workspace_id=$1 and role='owner'",
              [w],
            )
          ).rows.length,
          1,
        );
        assert.equal(
          (
            await db.query(
              "select * from public.chair_chats where workspace_id=$1 and title='General'",
              [w],
            )
          ).rows.length,
          1,
        );
      },
    );
    await t.test(
      "cannot send into a chat belonging to a different workspace",
      async () => {
        await assert.rejects(
          db.query("select public.chair_send_message($1,$2,'cross-scope',$3)", [
            w,
            second.chat.id,
            messageId,
          ]),
          /Chat unavailable/,
        );
      },
    );
    await t.test(
      "message retries deduplicate and reject changed payloads",
      async () => {
        const args = [w, c, "Hello", messageId];
        await db.query("select public.chair_send_message($1,$2,$3,$4)", args);
        await db.query("select public.chair_send_message($1,$2,$3,$4)", args);
        assert.equal(
          (
            await db.query(
              "select * from public.chair_messages where chat_id=$1",
              [c],
            )
          ).rows.length,
          1,
        );
        await assert.rejects(
          db.query("select public.chair_send_message($1,$2,'Different',$3)", [
            w,
            c,
            messageId,
          ]),
          /Message ID already used/,
        );
        await assert.rejects(
          db.query(
            "insert into public.chair_memberships(workspace_id,user_id,display_name,role) values ($1,$2,'Spoof','owner')",
            [w, outsider],
          ),
          /permission denied/,
        );
      },
    );
    await db.query(
      "select public.chair_create_invitation($1,'member@example.com',$2)",
      [w, token],
    );
    await t.test(
      "invitation hashes are not readable even by the owner",
      async () => {
        await assert.rejects(
          db.query("select token_hash from public.chair_invitations"),
          /permission denied/,
        );
      },
    );
    await asUser(outsider);
    await t.test(
      "outsiders cannot read another workspace or mutate it",
      async () => {
        for (const table of [
          "chair_workspaces",
          "chair_memberships",
          "chair_chats",
          "chair_messages",
          "chair_contracts",
          "chair_conflicts",
        ]) {
          assert.equal(
            (await db.query(`select * from public.${table}`)).rows.length,
            0,
          );
        }
        await assert.rejects(
          db.query("select public.chair_create_chat($1,'Intrusion')", [w]),
          /Workspace unavailable/,
        );
        await assert.rejects(
          db.query("select public.chair_send_message($1,$2,'Intrusion',$3)", [
            w,
            c,
            messageId,
          ]),
          /Chat unavailable/,
        );
        await assert.rejects(
          db.query("select public.chair_accept_invitation($1)", [token]),
          /Invitation unavailable/,
        );
      },
    );
    await asUser(member);
    await t.test(
      "matching verified email can accept; replay does not duplicate membership",
      async () => {
        for (let i = 0; i < 2; i++)
          assert.equal(
            (
              await db.query<{ id: string }>(
                "select public.chair_accept_invitation($1) as id",
                [token],
              )
            ).rows[0].id,
            w,
          );
        assert.equal(
          (await db.query("select * from public.chair_workspaces")).rows.length,
          1,
        );
        assert.equal(
          (await db.query("select * from public.chair_messages")).rows.length,
          1,
        );
        assert.equal(
          (
            await db.query(
              "select * from public.chair_memberships where user_id=$1",
              [member],
            )
          ).rows.length,
          1,
        );
        await assert.rejects(
          db.query(
            "select public.chair_create_invitation($1,'next@example.com',$2)",
            [w, "b".repeat(64)],
          ),
          /Only owners/,
        );
      },
    );
    await asUser(owner);
    await db.query(
      "select public.chair_create_invitation($1,'unconfirmed@example.com',$2)",
      [w, "c".repeat(64)],
    );
    await asUser(unconfirmed);
    await t.test(
      "an unconfirmed email cannot redeem an invitation",
      async () => {
        await assert.rejects(
          db.query("select public.chair_accept_invitation($1)", [
            "c".repeat(64),
          ]),
          /Invitation unavailable/,
        );
      },
    );
    await db.exec("reset role; set role anon");
    await t.test(
      "anonymous clients cannot read data or create workspaces",
      async () => {
        await assert.rejects(
          db.query("select * from public.chair_workspaces"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select public.chair_create_workspace('Bad')"),
          /permission denied/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
